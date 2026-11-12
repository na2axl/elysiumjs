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

import { Command, CommandArgumentType } from '@elysiumjs/core';
import prompts from 'prompts';

import { parseProjectConfig } from '../config';
import { createModule } from '../utils';
import { BaseCommand } from './base.command';

/**
 * Command for renaming Elysium.js modules.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
@Command.register()
export class ModuleRenameCommand extends BaseCommand {
	public static readonly command: string = 'module:rename';
	public static readonly description: string = 'Renames a module.';

	@Command.arg({
		description: 'The module to rename',
		type: CommandArgumentType.STRING
	})
	private module?: string;

	@Command.arg({
		description: 'The new name of the module',
		type: CommandArgumentType.STRING
	})
	private name?: string;

	public override async run(): Promise<void> {
		const config = await parseProjectConfig();

		if (config.mono) {
			return this.error('This operation is not supported for mono-module projects.');
		}

		if (!this.module) {
			const { module } = await prompts({
				type: 'text',
				name: 'module',
				message: 'Module to rename:',
				validate: (value) => value.length > 0
			});

			this.module = module as string;
		}

		if (!this.name) {
			const { name } = await prompts({
				type: 'text',
				name: 'name',
				message: 'New module name:',
				initial: this.module,
				validate: (value) => value.length > 0
			});

			this.name = name as string;
		}

		if (this.module === this.name) {
			return this.info('Module name is the same as the current name.');
		}

		await createModule(this.name!, this.module!);
		this.success(`Module '${this.module}' renamed to '${this.name}'.`);
	}
}
