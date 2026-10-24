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
import { pascal, snake } from 'radash';
import formatter from 'string-template';

import { addToModuleHint, getModulePath, parseProjectConfig } from '../config';
import { getRootPath } from '../utils';
import { BaseCommand } from './base.command';

/**
 * Maker class for creating Elysium.js commands.
 * @author Axel Nana <axel.nana@workbud.com>
 */
@Command.register()
export class MakeCommandCommand extends BaseCommand {
	public static readonly command: string = 'make:command';
	public static readonly description: string = 'Creates a new command.';

	@Command.arg({
		description: 'The name of the command to create',
		type: CommandArgumentType.STRING
	})
	private name?: string;

	@Command.arg({
		description: 'The module where the command will be created',
		type: CommandArgumentType.STRING
	})
	private module?: string;

	@Command.arg({
		description: 'The command to create',
		type: CommandArgumentType.STRING
	})
	private command?: string;

	@Command.arg({
		description: 'The description of the command',
		type: CommandArgumentType.STRING
	})
	private description?: string;

	public async run(): Promise<void> {
		if (!this.command || !this.name) {
			return this.setup();
		}

		const config = await parseProjectConfig();

		const answers: Record<string, any> = {
			module: this.module,
			name: this.name,
			command: this.command,
			description: this.description
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
				name: 'command',
				message: 'Command Name:',
				initial: 'user:say',
				validate(value: string) {
					if (value.length < 1) {
						return 'Command name cannot be empty';
					}

					return true;
				}
			},
			{
				type: 'text',
				name: 'description',
				message: 'Command Description:',
				initial: 'Say something',
				validate(value: string) {
					if (value.length < 1) {
						return 'Command description cannot be empty';
					}

					return true;
				}
			}
		];

		const answers = await prompts(items, {
			onCancel: () => {
				this.error('Operation cancelled.');
				process.exit(0);
			}
		});

		answers.name = pascal(answers.command.replaceAll(':', '_'));

		return this.build(answers);
	}

	private async build(answers: Record<string, any>): Promise<void> {
		if (!answers.name) {
			this.error('Operation cancelled.');
			return;
		}

		if (!answers.name.endsWith('Command')) {
			answers.name += 'Command';
		}

		// Get stub file
		const stubFile = Bun.file(join(getRootPath(), 'stubs/command.stub'));

		// Format the stub content
		const stub = formatter(await stubFile.text(), answers);

		const path = answers.module ? await getModulePath(answers.module) : './src';

		// Write to file
		const name = snake(answers.name.replace('Command', ''));
		const file = Bun.file(`${path}/commands/${name}.command.ts`);
		await file.write(stub);

		this.success(`Command ${this.bold(file.name!)} created successfully.`);
		this.info(await addToModuleHint('commands', answers.name, answers.module));
	}
}
