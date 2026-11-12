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

import { relative, resolve } from 'node:path';

import { Command, CommandArgumentType, ConsoleFormat } from '@elysiumjs/olympus';

import { parseProjectConfig } from '../config';
import { collectRoutes } from '../routes/collect';
import { renderRoutes } from '../routes/render';
import { getProjectPath, resolveAppEntry } from '../utils';
import { BaseCommand } from './base.command';

/**
 * Writes the route types of the app, for typed clients such as Eden: `treaty<AppRoutes>(url)`.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
@Command.register()
export class RoutesGenerateCommand extends BaseCommand {
	public static readonly command: string = 'routes:generate';
	public static readonly description: string =
		'Writes the route types of the app (AppRoutes) for typed clients.';

	@Command.arg({
		description:
			'The file to write, absolute or relative to the project (default: src/routes.gen.ts)',
		type: CommandArgumentType.STRING
	})
	private out?: string;

	public async run(): Promise<void> {
		const projectPath = getProjectPath();
		const config = await parseProjectConfig();
		const outFile = resolve(projectPath, this.out ?? config.routes ?? 'src/routes.gen.ts');

		const app = await resolveAppEntry(projectPath);
		const { modules, missing } = await collectRoutes(projectPath, app, outFile);

		await Bun.write(outFile, renderRoutes(modules));

		for (const name of missing) {
			this.warning(
				`${name} is not exported by a file of the project and no contributor types all its routes, so its routes are not in AppRoutes.`
			);
		}

		const count = modules.reduce(
			(total, module) =>
				total + module.controllers.reduce((sum, controller) => sum + controller.routes.length, 0),
			0
		);
		this.success(
			`Wrote ${count} routes to ${this.format(relative(projectPath, outFile), ConsoleFormat.BOLD)}.`
		);
	}
}
