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
 * Maker class for creating Elysium.js controllers.
 * @author Axel Nana <axel.nana@workbud.com>
 */
@Command.register()
export class MakeControllerCommand extends BaseCommand {
	public static readonly command: string = 'make:controller';
	public static readonly description: string = 'Creates a new controller.';

	@Command.arg({
		description: 'The name of the controller to create',
		type: CommandArgumentType.STRING
	})
	private name?: string;

	@Command.arg({
		description: 'The module where the controller will be created',
		type: CommandArgumentType.STRING
	})
	private module?: string;

	@Command.arg({
		description: 'Whether to create a HTTP controller',
		type: CommandArgumentType.BOOLEAN,
		default: false
	})
	private http: boolean = false;

	@Command.arg({
		description: 'Whether to create a WAMP controller',
		type: CommandArgumentType.BOOLEAN,
		default: false
	})
	private wamp: boolean = false;

	@Command.arg({
		description: 'Whether to create a WebSocket controller',
		type: CommandArgumentType.BOOLEAN,
		default: false
	})
	private ws: boolean = false;

	@Command.arg({
		description: 'Whether to create a SERVER scope controller',
		type: CommandArgumentType.BOOLEAN,
		default: false
	})
	private server: boolean = false;

	@Command.arg({
		description: 'Whether to create a REQUEST scope controller',
		type: CommandArgumentType.BOOLEAN,
		default: false
	})
	private request: boolean = false;

	@Command.arg({
		description: 'The path or URL of the controller',
		type: CommandArgumentType.STRING
	})
	private path: string = '/users';

	@Command.arg({
		description: 'The realm of the controller (only applicable to WAMP controllers)',
		type: CommandArgumentType.STRING
	})
	private realm?: string;

	public async run(): Promise<void> {
		if (!this.name) {
			return this.setup();
		}

		const config = await parseProjectConfig();

		const answers: Record<string, any> = {
			module: this.module,
			type: 'http',
			scope: 'SERVER',
			name: this.name,
			path: this.path,
			realm: this.realm ?? 'realm1'
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

		if (this.http) {
			answers.type = 'http';
		} else if (this.wamp) {
			answers.type = 'wamp';
		} else if (this.ws) {
			answers.type = 'ws';
		}

		if (this.server) {
			answers.scope = 'SERVER';
		} else if (this.request) {
			answers.scope = 'REQUEST';
		}

		return this.build(answers);
	}

	private async setup(): Promise<void> {
		let mode: 'http' | 'wamp' | 'ws' = 'http';

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
				type: 'select',
				name: 'type',
				message: 'Controller Type:',
				choices: [
					{ title: 'HTTP', value: 'http' },
					{ title: 'WAMP', value: 'wamp' },
					{ title: 'WebSocket', value: 'ws' }
				]
			},
			{
				type: 'text',
				name: 'name',
				message: 'Controller Name:',
				initial: 'UserController',
				validate: (value: string) => {
					if (value.length < 1) {
						return 'Controller name cannot be empty';
					}

					return true;
				}
			},
			{
				type: 'text',
				name: 'path',
				message(_prev, values) {
					mode = values.type;
					return values.type === 'wamp' ? 'Controller URL' : 'Controller Path:';
				},
				initial(_prev, values) {
					return values.type === 'wamp' ? 'ws://localhost:8000' : '/users';
				},
				validate(value) {
					if (mode === 'wamp') {
						return value.match(/^wss?:\/\//) ? true : 'The URL must start with ws:// or wss://';
					}

					if (value[0] !== '/') {
						return 'The path must start with a slash (/)';
					}

					return true;
				}
			},
			{
				type(_prev, values) {
					return values.type === 'http' ? 'select' : null;
				},
				name: 'scope',
				message: 'Controller Scope:',
				choices: [
					{
						title: 'SERVER',
						value: 'SERVER',
						description:
							'An unique instance of the controller is created for the entire lifecycle of the server.'
					},
					{
						title: 'REQUEST',
						value: 'REQUEST',
						description: 'An instance of the controller is created for each request.'
					}
				]
			},
			{
				type(_prev, values) {
					return values.type === 'wamp' ? 'text' : null;
				},
				name: 'realm',
				message: 'Controller Realm:',
				initial: 'realm1',
				validate(value) {
					if (value.length < 1) {
						return 'Realm name cannot be empty';
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

		return this.build(answers);
	}

	private async build(answers: Record<string, any>): Promise<void> {
		if (!answers.type || !answers.name || !answers.path) {
			this.error('Operation cancelled.');
			return;
		}

		if (!answers.name.endsWith('Controller')) {
			answers.name += 'Controller';
		}

		// Get stub file
		const stubFile = Bun.file(join(getRootPath(), `stubs/${answers.type}.controller.stub`));

		// Format the stub content
		const stub = formatter(await stubFile.text(), answers);

		const path = answers.module ? await getModulePath(answers.module) : './src';

		// Write to file
		const name = snake(answers.name.replace('Controller', ''));
		const file = Bun.file(`${path}/controllers/${answers.type}/${name}.controller.ts`);
		await file.write(stub);

		this.success(`Controller ${this.bold(file.name!)} created successfully.`);
		this.info(await addToModuleHint('controllers', answers.name, answers.module));
	}
}
