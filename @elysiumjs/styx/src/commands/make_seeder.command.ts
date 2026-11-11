// Copyright (c) 2026-present Workbud Technologies Inc. All rights reserved.
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
import { addToModuleHint, getModulePath, parseProjectConfig } from '../config';
import { fileName } from '../utils';
import { BaseCommand } from './base.command';

/**
 * Maker class for creating Mnemosyne seeders.
 * @author Axel Nana <axel.nana@workbud.com>
 */
@Command.register()
export class MakeSeederCommand extends BaseCommand {
	public static readonly command: string = 'make:seeder';
	public static readonly description: string = 'Creates a new seeder.';

	@Command.arg({
		description: 'The name of the seeder to create',
		type: CommandArgumentType.STRING
	})
	private name?: string;

	@Command.arg({
		description: 'The module where the seeder will be created',
		type: CommandArgumentType.STRING
	})
	private module?: string;

	public async run(): Promise<void> {
		const config = await parseProjectConfig();
		const items: PromptObject[] = [
			{
				type: () => (this.module || config.mono ? null : 'select'),
				name: 'module',
				message: 'Module:',
				choices: () =>
					Object.keys(config.modules ?? {}).map((moduleName) => ({
						title: moduleName,
						value: moduleName
					}))
			},
			{
				type: () => (this.name ? null : 'text'),
				name: 'name',
				message: 'Seeder Name:',
				initial: 'CountriesSeeder',
				validate: (value: string) => (value.length < 1 ? 'Seeder name cannot be empty' : true)
			}
		];

		const answers = await prompts(items, {
			onCancel: () => {
				this.error('Operation cancelled.');
				process.exit(0);
			}
		});

		return this.build({
			module: this.module ?? answers.module,
			name: this.name ?? answers.name
		});
	}

	private async build(answers: { module?: string; name?: string }): Promise<void> {
		if (!answers.name) {
			this.error('Operation cancelled.');
			return;
		}

		const name = answers.name.endsWith('Seeder') ? answers.name : `${answers.name}Seeder`;
		const stub = formatter(await readAsset('stubs/seeder.stub'), { name });
		const path = answers.module ? await getModulePath(answers.module) : './src';

		const file = Bun.file(`${path}/seeders/${fileName(name.replace(/Seeder$/, ''))}.seeder.ts`);
		await file.write(stub);

		this.success(`Seeder ${this.bold(file.name!)} created successfully.`);
		this.info(await addToModuleHint('seeders', name, answers.module));
	}
}
