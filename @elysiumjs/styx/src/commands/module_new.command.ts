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

import { exists, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { Command, CommandArgumentType } from '@elysiumjs/core';
import prompts from 'prompts';
import { snake } from 'radash';

import { parseProjectConfig } from '../config';
import { createModule, getProjectPath } from '../utils';
import { BaseCommand } from './base.command';

/**
 * Command for creating Elysium.js modules.
 * @author Axel Nana <axel.nana@workbud.com>
 */
@Command.register()
export class ModuleNewCommand extends BaseCommand {
	public static readonly command: string = 'module:new';
	public static readonly description: string = 'Creates a new module.';

	@Command.arg({
		description: 'The name of the module to create',
		type: CommandArgumentType.STRING
	})
	private name?: string;

	private module?: string;
	private convert: boolean = false;

	public override async run(): Promise<void> {
		const config = await parseProjectConfig();

		// 1. Prompt for new module name if not provided
		if (!this.name) {
			const name = await prompts(
				{
					type: 'text',
					name: 'name',
					message: 'New module name:',
					initial: 'module',
					validate(value) {
						return value.length > 0 ? true : 'Module name cannot be empty';
					}
				},
				{
					onCancel: () => process.exit(0)
				}
			);

			this.name = snake(name.name);
		}

		// 2. If mono-module, prompt for conversion and current module name
		if (config.mono) {
			const { module, convert } = await prompts(
				[
					{
						type: 'confirm',
						name: 'convert',
						message:
							'This project is a mono-module project. Do you want to convert it to a multi-module project?',
						initial: false
					},
					{
						type: (convert) => (convert ? 'text' : null),
						name: 'module',
						message: 'Current module name:',
						initial: 'main',
						validate(value) {
							return value.length > 0 ? true : 'Module name cannot be empty';
						}
					}
				],
				{
					onCancel: () => process.exit(0)
				}
			);

			if (!convert) return this.error('Operation cancelled. The project is left unchanged.');

			this.module = snake(module as string);
			this.convert = convert;
		}

		// 3. If multi-module conversion is enabled, convert the project to a multi-module project
		if (this.convert) {
			const modulesDir = join(getProjectPath(), 'src', 'modules');
			if (await exists(modulesDir)) await rm(modulesDir, { recursive: true });

			await createModule(this.module!, 'root');

			this.success(`Project converted to multi-module.`);
			this.success(`Module '${this.module}' created.`);
		}

		// 4. Create the new module
		await createModule(this.name);
		this.success(`Module '${this.name}' created.`);
	}
}
