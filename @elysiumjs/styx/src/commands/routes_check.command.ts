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

import { Command } from '@elysiumjs/core';

import { routesWithoutResponse } from '../routes/check';
import { getProjectPath, resolveAppEntry } from '../utils';
import { BaseCommand } from './base.command';

/**
 * Checks that every route of the app declares the schema of its success response.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
@Command.register()
export class RoutesCheckCommand extends BaseCommand {
	public static readonly command: string = 'routes:check';
	public static readonly description: string =
		'Checks that every route of the app declares the schema of its success response.';

	public async run(): Promise<void> {
		const app = await resolveAppEntry(getProjectPath());
		const missing = await routesWithoutResponse(app);

		for (const route of missing) {
			this.error(
				`${route.method} ${route.path} (${route.controller}.${route.handler}) declares no response schema.`
			);
		}
		if (missing.length > 0) {
			this.write('Declare the success response with the `response` option of the route.');
			process.exit(1);
		}
		this.success('Every route declares its response schema.');
	}
}
