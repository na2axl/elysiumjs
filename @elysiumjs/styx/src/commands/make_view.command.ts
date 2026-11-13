// Copyright (c) 2026-present Axel Nana <ax.lnana@outlook.com>. All rights reserved.
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
import formatter from 'string-template';

import { readAsset } from '../assets';
import { getModulePath, parseProjectConfig } from '../config';
import { fileName } from '../utils';
import { BaseCommand } from './base.command';

/**
 * Maker command for creating Elysium views.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
@Command.register()
export class MakeViewCommand extends BaseCommand {
	public static readonly command: string = 'make:view';
	public static readonly description: string = 'Creates a new view.';

	@Command.arg({
		description: 'The name of the view to create',
		type: CommandArgumentType.STRING
	})
	private name?: string;

	@Command.arg({
		description: 'The module where the view will be created',
		type: CommandArgumentType.STRING
	})
	private module?: string;

	public async run(): Promise<void> {
		if (!this.name) {
			return this.setup();
		}

		const config = await parseProjectConfig();
		const answers: Record<string, any> = { module: this.module, name: this.name };

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
				message: 'View Name:',
				initial: 'PostView',
				validate(value: string) {
					if (value.length < 1) {
						return 'View name cannot be empty';
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
		if (!answers.name) {
			this.error('Operation cancelled.');
			return;
		}

		answers.name = String(answers.name)
			.split(/[^A-Za-z0-9]+/)
			.filter(Boolean)
			.map((part) => part[0]!.toUpperCase() + part.slice(1))
			.join('');
		if (!answers.name.endsWith('View')) {
			answers.name += 'View';
		}

		const stub = formatter(await readAsset('stubs/view.stub'), answers);
		const path = answers.module ? await getModulePath(answers.module) : './src';

		const name = fileName(answers.name.replace(/View$/, ''));
		const file = Bun.file(`${path}/views/${name}.view.ts`);
		await file.write(stub);

		this.success(`View ${this.bold(file.name!)} created successfully.`);
	}
}
