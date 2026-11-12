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

import { Command, CommandArgumentType, Runtime } from '@elysiumjs/core';
import { Redis } from '@elysiumjs/redis';

import { ScheduleRunner } from '../schedule';

/**
 * Runs the scheduler: dispatches the scheduled jobs at their times.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
@Command.register()
export class HeraclesScheduleCommand extends Command {
	public static readonly command: string = 'heracles:schedule';
	public static readonly description: string = 'Dispatch the scheduled jobs at their times.';
	public static readonly boot = true;

	@Command.arg({
		name: 'redis',
		required: false,
		description:
			'The Redis connection holding the lock of each tick, so that several schedulers dispatch it once',
		type: CommandArgumentType.STRING
	})
	private redis?: string;

	public async run(): Promise<void> {
		if (this.redis !== undefined && !Redis.connectionExists(this.redis)) {
			this.error(`Redis connection "${this.redis}" does not exist`);
			Runtime.get().exit(1);
		}

		const scheduler = new ScheduleRunner({ redis: this.redis ?? false });
		const jobs = scheduler.start();
		if (jobs.length === 0) this.warning('No job is scheduled.');
		for (const { name, schedule } of jobs) {
			this.info(`${this.bold(name)} runs at ${schedule.cron.expression} (UTC)`);
		}

		Runtime.get().onShutdown(async () => {
			scheduler.stop();
			Runtime.get().exit(0);
		});

		await new Promise<void>(() => {});
	}
}
