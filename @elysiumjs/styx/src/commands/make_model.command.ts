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

import { Command, CommandArgumentType } from '@elysiumjs/olympus';
import prompts from 'prompts';
import { pascal, trim } from 'radash';
import formatter from 'string-template';

import { readAsset } from '../assets';
import { getModulePath, parseProjectConfig } from '../config';
import { fileName } from '../utils';
import { BaseCommand } from './base.command';

/**
 * Maker command for creating Elysium.js models.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
@Command.register()
export class MakeModelCommand extends BaseCommand {
	public static readonly command: string = 'make:model';
	public static readonly description: string = 'Creates a new model.';

	@Command.arg({
		description: 'The name of the model to create',
		type: CommandArgumentType.STRING
	})
	private name?: string;

	@Command.arg({
		description: 'The module where the model will be created',
		type: CommandArgumentType.STRING
	})
	private module?: string;

	@Command.arg({
		name: 'table',
		description: 'The name of the table wrapped by the model',
		type: CommandArgumentType.STRING
	})
	private tableName?: string;

	@Command.arg({
		name: 'support-tenancy',
		description: 'Support tenancy',
		type: CommandArgumentType.BOOLEAN,
		default: false
	})
	private supportTenancy: boolean = false;

	public async run(): Promise<void> {
		if (!this.name || !this.tableName) {
			return this.setup();
		}

		const config = await parseProjectConfig();

		const answers: Record<string, any> = {
			module: this.module,
			table: this.tableName,
			name: this.name,
			supportTenancy: this.supportTenancy
		};

		if (!answers.module && !config.mono) {
			const module = await prompts(
				{
					type: 'select',
					name: 'module',
					message: 'Module:',
					choices: Object.keys(config.modules ?? {}).map((moduleName) => ({
						title: moduleName,
						value: moduleName
					}))
				},
				{
					onCancel: () => process.exit(1)
				}
			);

			answers.module = module.module;
		}

		if (!answers.name) {
			answers.name = trim(pascal(answers.table), 's');
		}

		answers.canonicalName = answers.name;

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
				name: 'table',
				message: 'Table Name:',
				initial: 'users',
				validate(value: string) {
					if (value.length < 1) {
						return 'Table name cannot be empty';
					}

					return true;
				}
			},
			{
				type: 'text',
				name: 'name',
				message: 'Model Name:',
				initial(_, values) {
					return trim(pascal(values.table), 's');
				},
				validate(value: string) {
					if (value.length < 1) {
						return 'Model name cannot be empty';
					}

					return true;
				}
			},
			{
				type: 'select',
				name: 'supportTenancy',
				message: 'Support Tenancy:',
				initial: 1,
				choices: [
					{
						title: 'Yes',
						value: true,
						description: 'The model supports multi-tenancy.'
					},
					{
						title: 'No',
						value: false,
						description: 'The model does not support multi-tenancy.'
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

		if (!answers.name.endsWith('Model')) {
			answers.name += 'Model';
		}

		answers.canonicalName = answers.name.replace('Model', '');
		// A model is not tenant-scoped by default, so the line is written only when it is.
		answers.class_body = answers.supportTenancy
			? '{\n\tpublic static readonly supportTenancy = true;\n}'
			: '{}';

		// Get stub file
		const stubText = await readAsset('stubs/model.stub');

		// Format the stub content
		const stub = formatter(stubText, answers);

		const path = answers.module ? await getModulePath(answers.module) : './src';

		// Write to file
		const name = fileName(answers.name.replace('Model', ''));
		const file = Bun.file(`${path}/models/${name}.model.ts`);
		await file.write(stub);

		this.success(`Model ${this.bold(file.name!)} created successfully.`);
	}
}
