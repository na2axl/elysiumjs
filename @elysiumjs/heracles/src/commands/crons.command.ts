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

import { Command, CommandArgumentType, Runtime } from '@elysiumjs/core';

import { JobRegistry } from '../registry';
import { Scheduler } from '../schedule';
import { parseJsonc } from '../utils';

/** The parts of a wrangler configuration the check reads. */
type WranglerConfig = {
	triggers?: { crons?: unknown };
	env?: Record<string, { triggers?: { crons?: unknown } } | undefined>;
};

/** The cron triggers of one environment of a wrangler configuration. */
export type WranglerTriggers = { environment: string | null; crons: string[] };

const cronsOf = (triggers: { crons?: unknown } | undefined): string[] | undefined =>
	Array.isArray(triggers?.crons)
		? triggers.crons.filter((cron): cron is string => typeof cron === 'string')
		: undefined;

/**
 * The cron triggers of a wrangler configuration: those at the top level, and those of each
 * environment that sets its own (an environment without `triggers` inherits the top level).
 * @author Axel Nana <axel.nana@workbud.com>
 * @param config The parsed configuration.
 * @param environment Only this environment, with the triggers it sets or inherits.
 * @returns The triggers per environment; `environment` is `null` for the top level.
 * @throws {Error} When the configuration has no such environment.
 */
export const wranglerTriggers = (config: unknown, environment?: string): WranglerTriggers[] => {
	const { triggers, env = {} } = (config ?? {}) as WranglerConfig;
	const top = cronsOf(triggers) ?? [];
	if (environment !== undefined) {
		if (!(environment in env))
			throw new Error(`The configuration has no environment "${environment}".`);
		return [{ environment, crons: cronsOf(env[environment]?.triggers) ?? top }];
	}
	const own = Object.entries(env).flatMap(([name, settings]) => {
		const crons = cronsOf(settings?.triggers);
		return crons ? [{ environment: name, crons }] : [];
	});
	return [{ environment: null, crons: top }, ...own];
};

/**
 * Prints the scheduled jobs and the cron triggers they need, or checks the cron triggers of a
 * wrangler configuration. It reads the jobs from the module graph without booting the
 * application, so it runs for an application whose services need a runtime it is not in, such as
 * a Cloudflare Worker.
 * @author Axel Nana <axel.nana@workbud.com>
 */
@Command.register()
export class HeraclesCronsCommand extends Command {
	public static readonly command: string = 'heracles:crons';
	public static readonly description: string =
		'Print the cron triggers the scheduled jobs need, or check those of a wrangler configuration.';

	@Command.arg({
		name: 'check',
		required: false,
		description:
			'The path of a wrangler configuration whose cron triggers must match the scheduled jobs',
		type: CommandArgumentType.STRING
	})
	private check?: string;

	@Command.arg({
		name: 'env',
		required: false,
		description: 'Only check this environment of the wrangler configuration',
		type: CommandArgumentType.STRING
	})
	private env?: string;

	public async run(): Promise<void> {
		JobRegistry.set(JobRegistry.collect());
		if (this.check === undefined) return this.print();
		return this.checkWrangler(this.check);
	}

	private print(): void {
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
		let targets: WranglerTriggers[];
		try {
			// portability-allow: a CLI command, run on the host where the wrangler file lives
			const { readFile } = await import('node:fs/promises');
			targets = wranglerTriggers(parseJsonc(await readFile(path, 'utf8')), this.env);
		} catch (error) {
			this.error(`Cannot check ${path}: ${error instanceof Error ? error.message : String(error)}`);
			return Runtime.get().exit(1);
		}

		let failed = false;
		for (const { environment, crons } of targets) {
			const where = environment === null ? 'triggers.crons' : `env.${environment}.triggers.crons`;
			const { missing, extra } = Scheduler.compareCrons(crons);
			for (const cron of missing) {
				const names = Scheduler.jobsFor(cron).map(({ name }) => name);
				this.error(`${where}: no trigger runs ${cron}, the schedule of ${names.join(', ')}.`);
			}
			for (const cron of extra) this.error(`${where}: the trigger ${cron} runs no scheduled job.`);
			if (missing.length > 0 || extra.length > 0) failed = true;
		}
		if (failed) {
			this.write(`Set the cron triggers to ${JSON.stringify(Scheduler.crons())}.`);
			return Runtime.get().exit(1);
		}
		this.success(`The cron triggers of ${path} match the scheduled jobs.`);
		Runtime.get().exit(0);
	}
}
