// Copyright (c) 2025-present Workbud Technologies Inc. All rights reserved.
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

import { join } from 'node:path';

import { Command, CommandArgumentType } from '@elysiumjs/core';
import prompts from 'prompts';
import { snake } from 'radash';
import formatter from 'string-template';

import { addToModuleHint, getModulePath, parseProjectConfig } from '../config';
import { getRootPath } from '../utils';
import { BaseCommand } from './base.command';

/**
 * Maker command for creating Elysium services.
 * @author Axel Nana <axel.nana@workbud.com>
 */
@Command.register()
export class MakeServiceCommand extends BaseCommand {
	public static readonly command: string = 'make:service';
	public static readonly description: string = 'Creates a new service.';

	@Command.arg({
		description: 'The name of the service to create',
		type: CommandArgumentType.STRING
	})
	private name?: string;

	@Command.arg({
		description: 'The module where the service will be created',
		type: CommandArgumentType.STRING
	})
	private module?: string;

	@Command.arg({
		description: 'The alias of the service to create',
		type: CommandArgumentType.STRING
	})
	private alias?: string;

	@Command.arg({
		description: 'Create a factory service',
		type: CommandArgumentType.BOOLEAN,
		default: false
	})
	private factory: boolean = false;

	@Command.arg({
		description: 'Create a singleton service',
		type: CommandArgumentType.BOOLEAN,
		default: false
	})
	private singleton: boolean = false;

	public async run(): Promise<void> {
		if (!this.name) {
			return this.setup();
		}

		const config = await parseProjectConfig();

		const answers: Record<string, any> = {
			module: this.module,
			name: this.name,
			alias: this.alias,
			scope: this.factory ? 'FACTORY' : this.singleton ? 'SINGLETON' : 'SINGLETON'
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
				message: 'Service Name:',
				initial: 'UserService',
				validate(value: string) {
					if (value.length < 1) {
						return 'Service name cannot be empty';
					}

					return true;
				}
			},
			{
				type: 'text',
				name: 'alias',
				message: 'Service Alias:',
				initial(_, values) {
					return values.name;
				},
				validate(value: string) {
					if (value.length < 1) {
						return 'Service alias cannot be empty';
					}

					return true;
				}
			},
			{
				type: 'select',
				name: 'scope',
				message: 'Service Scope:',
				choices: [
					{
						title: 'SINGLETON',
						value: 'SINGLETON',
						description: 'A single instance of the service is created.'
					},
					{
						title: 'FACTORY',
						value: 'FACTORY',
						description: 'A new instance of the service is created each time it is injected.'
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

		if (!answers.name.endsWith('Service')) {
			answers.name += 'Service';
		}

		if (!answers.alias) {
			answers.alias = answers.name;
		}

		// Get stub file
		const stubFile = Bun.file(join(getRootPath(), 'stubs/service.stub'));

		// Format the stub content
		const stub = formatter(await stubFile.text(), answers);

		const path = answers.module ? await getModulePath(answers.module) : './src';

		// Write to file
		const name = snake(answers.name.replace('Service', ''));
		const file = Bun.file(`${path}/services/${name}.service.ts`);
		await file.write(stub);

		this.success(`Service ${this.bold(file.name!)} created successfully.`);
		this.info(await addToModuleHint('services', answers.name, answers.module));
	}
}
