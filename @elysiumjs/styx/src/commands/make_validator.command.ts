// Copyright (c) 2025-present Axel Nana <ax.lnana@outlook.com>. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import type { PromptObject } from 'prompts';

import { Command, CommandArgumentType } from '@elysiumjs/core';
import prompts from 'prompts';
import formatter from 'string-template';

import { readAsset } from '../assets';
import { getModulePath, parseProjectConfig } from '../config';
import { fileName } from '../utils';
import { BaseCommand } from './base.command';

/**
 * Maker command for creating Elysium validators.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
@Command.register()
export class MakeValidatorCommand extends BaseCommand {
	public static readonly command: string = 'make:validator';
	public static readonly description: string = 'Creates a new validator.';

	@Command.arg({
		description: 'The name of the validator to create',
		type: CommandArgumentType.STRING
	})
	private name?: string;

	@Command.arg({
		description: 'The module where the validator will be created',
		type: CommandArgumentType.STRING
	})
	private module?: string;

	@Command.arg({
		description: 'Adds an authorize() method, checked before the schema',
		type: CommandArgumentType.BOOLEAN,
		default: false
	})
	private authorize: boolean = false;

	@Command.arg({
		description: 'Adds a validate() method, for checks the schema cannot express',
		type: CommandArgumentType.BOOLEAN,
		default: false
	})
	private validate: boolean = false;

	public async run(): Promise<void> {
		if (!this.name) {
			return this.setup();
		}

		const config = await parseProjectConfig();

		const answers: Record<string, any> = {
			module: this.module,
			name: this.name,
			methods: [...(this.authorize ? ['authorize'] : []), ...(this.validate ? ['validate'] : [])]
		};

		if (!answers.module && !config.mono) {
			const module = await prompts({
				type: 'select',
				name: 'module',
				message: 'Module:',
				choices: Object.keys(config.modules ?? {}).map((moduleName) => ({
					title: moduleName,
					value: moduleName
				}))
			});

			answers.module = module.module;
		}

		return this.build(answers);
	}

	private async setup(): Promise<void> {
		const config = await parseProjectConfig();

		const items: PromptObject[] = [
			{
				type() {
					return config.mono ? null : 'select';
				},
				name: 'module',
				message: 'Module:',
				choices() {
					return Object.keys(config.modules ?? {}).map((moduleName) => ({
						title: moduleName,
						value: moduleName
					}));
				}
			},
			{
				type: 'text',
				name: 'name',
				message: 'Validator Name:',
				initial: 'LoginValidator',
				validate(value: string) {
					if (value.length < 1) {
						return 'Validator name cannot be empty';
					}

					return true;
				}
			},
			{
				type: 'multiselect',
				name: 'methods',
				message: 'Methods besides the schema:',
				instructions: false,
				choices: [
					{
						title: 'authorize',
						value: 'authorize',
						description: 'Whether the request may be handled, checked before the schema.'
					},
					{
						title: 'validate',
						value: 'validate',
						description: 'Checks that the schema cannot express.'
					}
				]
			}
		];

		const answers = await prompts(items, {
			onCancel: () => {
				this.error('Operation cancelled.');
				process.exit(0);
			}
		});

		return this.build(answers);
	}

	private async build(answers: Record<string, any>): Promise<void> {
		if (!answers.name) {
			this.error('Operation cancelled.');
			return;
		}

		if (!answers.name.endsWith('Validator')) {
			answers.name += 'Validator';
		}

		if (!answers.request_name) {
			answers.request_name = answers.name.replace('Validator', 'Request');
		}

		// The schema is all most validators need: the methods are added only when asked for.
		const methods: string[] = answers.methods ?? [];
		let body = '';
		for (const method of ['authorize', 'validate']) {
			if (methods.includes(method)) body += await readAsset(`stubs/validator.${method}.stub`);
		}

		const stubText = await readAsset('stubs/validator.stub');
		const stub = formatter(stubText, {
			...answers,
			core_types: methods.length > 0 ? 'Context, DomainError, Static' : 'Static',
			methods: formatter(body, answers)
		});

		const path = answers.module ? await getModulePath(answers.module) : './src';

		// Write to file
		const name = fileName(answers.name.replace('Validator', ''));
		const file = Bun.file(`${path}/validators/${name}.validator.ts`);
		await file.write(stub);

		this.success(`Validator ${this.bold(file.name!)} created successfully.`);
	}
}
