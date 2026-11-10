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

import { Command, CommandArgumentType, Runtime } from '@elysiumjs/core';
import { Redis } from '@elysiumjs/redis';

import { Scheduler, ScheduleRunner } from '../schedule';
import { parseJsonc } from '../utils';

/**
 * Runs the scheduler: dispatches the scheduled jobs at their times.
 * @author Axel Nana <axel.nana@workbud.com>
 */
@Command.register()
export class HeraclesScheduleCommand extends Command {
	public static readonly command: string = 'heracles:schedule';
	public static readonly description: string =
		'Dispatch the scheduled jobs at their times, or list or check their cron expressions.';
	public static readonly boot = true;

	@Command.arg({
		name: 'redis',
		required: false,
		description:
			'The Redis connection holding the lock of each tick, so that several schedulers dispatch it once',
		type: CommandArgumentType.STRING
	})
	private redis?: string;

	@Command.arg({
		name: 'list',
		required: false,
		description: 'Print the scheduled jobs and the cron triggers they need, then exit',
		type: CommandArgumentType.BOOLEAN
	})
	private list?: boolean;

	@Command.arg({
		name: 'check',
		required: false,
		description:
			'The path of a wrangler.jsonc whose triggers.crons must match the cron expressions of the scheduled jobs',
		type: CommandArgumentType.STRING
	})
	private check?: string;

	public async run(): Promise<void> {
		if (this.list) return this.printList();
		if (this.check !== undefined) return this.checkWrangler(this.check);

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

	private printList(): void {
		const jobs = Scheduler.jobs();
		if (jobs.length === 0) this.warning('No job is scheduled.');
		for (const { name, schedule } of jobs) {
			this.write(`${schedule.cron.expression.padEnd(20)} ${name}`);
		}
		const crons = Scheduler.crons();
		if (crons.length > 0) this.write(`\nCron triggers: ${JSON.stringify(crons)}`);
		Runtime.get().exit(0);
	}

	private async checkWrangler(path: string): Promise<void> {
		let declared: unknown;
		try {
			// portability-allow: a CLI command, run on the host where the wrangler file lives
			const { readFile } = await import('node:fs/promises');
			declared = (parseJsonc(await readFile(path, 'utf8')) as { triggers?: { crons?: unknown } })
				.triggers?.crons;
		} catch (error) {
			this.error(`Cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`);
			return Runtime.get().exit(1);
		}

		const crons = Array.isArray(declared)
			? declared.filter((cron) => typeof cron === 'string')
			: [];
		const { missing, extra } = Scheduler.compareCrons(crons);
		for (const cron of missing) {
			const names = Scheduler.jobsFor(cron).map(({ name }) => name);
			this.error(`No trigger runs ${cron}, the schedule of ${names.join(', ')}.`);
		}
		for (const cron of extra) this.error(`The trigger ${cron} runs no scheduled job.`);
		if (missing.length > 0 || extra.length > 0) {
			this.write(`Set triggers.crons to ${JSON.stringify(Scheduler.crons())}.`);
			return Runtime.get().exit(1);
		}
		this.success(`The cron triggers of ${path} match the scheduled jobs.`);
		Runtime.get().exit(0);
	}
}
