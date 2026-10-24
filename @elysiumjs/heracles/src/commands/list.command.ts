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

import { Command, ConsoleFormat, InteractsWithConsole } from '@elysiumjs/core';

import { JobRegistry } from '../registry';

/**
 * Command used to list all registered Heracles jobs.
 * @author Axel Nana <axel.nana@workbud.com>
 */
@Command.register()
export class HeraclesListCommand extends Command {
	public static readonly command: string = 'heracles:list';
	public static readonly description: string = 'List all registered Heracles jobs and schedulers.';

	public async run(): Promise<void> {
		const jobs = JobRegistry.all();

		if (jobs.length === 0) {
			this.write('No registered jobs found.');
		} else {
			this.title('Jobs:');
			for (const { name, jobClass: job } of jobs) {
				const alias = name.replace('elysium.heracles.job.', '');
				const args = alias === job.name ? ' ' : ` (${job.name}) `;

				this.write(
					` ${this.format(alias, ConsoleFormat.CYAN)}${args}${'∙'.repeat(InteractsWithConsole.SPACE_WIDTH - alias.length - args.length)} ${job.description}`
				);
			}
		}
	}
}
