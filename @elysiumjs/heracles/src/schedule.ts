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

import type { CronSchedule } from './cron';
import type { Job, JobClass } from './job';

import { ElysiumError, getLogger, Metadata } from '@elysiumjs/core';
import { Redis } from '@elysiumjs/redis';

import { Cron } from './cron';
import { Heracles } from './heracles';
import { JobRegistry } from './registry';

const SCHEDULES = Symbol.for('elysium:heracles:Schedules');

/**
 * Options of {@link Schedule}.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type ScheduleOptions = {
	/** The arguments the job is dispatched with. */
	args?: unknown[];
	/**
	 * The static method of the job class that selects the cases due at a tick, such as the
	 * invoices to bill. It receives the tick (UTC, to the minute) and returns the cases, JSON-safe.
	 * Each case is dispatched as a job of its own, with the case after `args`, and with a dispatch
	 * id made of the job, the case key and the tick, the same however often the tick is handled:
	 * `@Once()` of `@elysiumjs/moirai/heracles` runs it once.
	 */
	fanOut?: string;
	/** Names a case in its dispatch id. Defaults to its `id`, else its JSON. */
	key?: (selected: any) => string;
};

/**
 * Raised when `@Schedule()` names a fan-out method the job class does not have.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class InvalidScheduleError extends ElysiumError {
	constructor(job: string, reason: string) {
		super(`The schedule of ${job} ${reason}.`);
	}
}

/** The default key of a case: its `id`, else its JSON. */
const defaultKey = (selected: unknown): string =>
	typeof selected === 'object' && selected !== null && 'id' in selected
		? String((selected as { id: unknown }).id)
		: JSON.stringify(selected);

/**
 * A schedule of a job class.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type JobSchedule = {
	readonly cron: CronSchedule;
	readonly args: unknown[];
	/** The static method that selects the cases of a fan-out schedule. */
	readonly fanOut?: string;
	/** Names a case of a fan-out schedule. */
	readonly key: (selected: unknown) => string;
};

/**
 * Dispatches a job on a cron schedule, in UTC. On Bun and Node.js, the `heracles:schedule`
 * command runs the {@link Scheduler}; on Cloudflare Workers, `HeraclesWorkersModule`
 * (`@elysiumjs/heracles-workers`) dispatches the jobs whose expression is the one of the cron
 * trigger, so list the same expression in the wrangler config. A job can have several schedules.
 * @author Axel Nana <axel.nana@workbud.com>
 * @param cron The cron expression (5 fields, or an alias such as `@daily`).
 * @param options The arguments of the dispatch.
 * @throws {InvalidCronError} When the expression is not valid.
 *
 * With `fanOut`, the schedule selects the cases due at the tick and dispatches one job per case,
 * so that each case retries, fails and dead-letters on its own.
 * @example
 * ```ts
 * @Job.register({ queue: 'default' })
 * @Schedule('0 3 * * *')
 * class PurgeExpiredSessions extends Job {
 * 	protected async execute() {}
 * }
 *
 * @Job.register({ queue: 'billing' })
 * @Schedule('0 6 * * *', { fanOut: 'due' })
 * class BillInvoice extends Job {
 * 	public static async due(tick: Date): Promise<{ id: string }[]> {
 * 		return invoices.dueAt(tick);
 * 	}
 *
 * 	constructor(private readonly invoice: { id: string }) {
 * 		super();
 * 	}
 *
 * 	protected async execute() {}
 * }
 * ```
 */
export const Schedule =
	(cron: string, options: ScheduleOptions = {}) =>
	(target: Function): void => {
		const { fanOut } = options;
		if (fanOut !== undefined && typeof (target as any)[fanOut] !== 'function') {
			throw new InvalidScheduleError(
				target.name,
				`fans out with "${fanOut}", which is not a static method`
			);
		}
		const schedules: JobSchedule[] = Metadata.getOwn(SCHEDULES, target) ?? [];
		const schedule: JobSchedule = {
			cron: Cron.parse(cron),
			args: options.args ?? [],
			key: options.key ?? defaultKey,
			...(fanOut !== undefined ? { fanOut } : {})
		};
		Metadata.define(SCHEDULES, [...schedules, schedule], target);
	};

/**
 * The schedules of a job class.
 * @author Axel Nana <axel.nana@workbud.com>
 * @param jobClass The job class.
 */
export const schedulesOf = (jobClass: Function): readonly JobSchedule[] =>
	Metadata.getOwn(SCHEDULES, jobClass) ?? [];

/**
 * A scheduled job of the registry, with one of its schedules.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type ScheduledJob = { name: string; jobClass: JobClass<Job>; schedule: JobSchedule };

/**
 * Options of the {@link Scheduler}.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type SchedulerOptions = {
	/**
	 * The Redis connection that holds the lock of each tick, so that one process dispatches it
	 * when several run the scheduler. `false` runs without a lock. Defaults to `false`.
	 */
	redis?: string | false;
	/** How long a tick's lock is kept, in milliseconds. Defaults to 60 seconds. */
	lockTtl?: number;
};

/** The longest a timer waits before planning again: timers overflow past about 24.8 days. */
const MAX_WAIT = 24 * 60 * 60 * 1000;

/**
 * Dispatches the scheduled jobs of the registry at their times, with in-process timers. With a
 * Redis connection, each tick takes a lock first, so that running the scheduler in several
 * processes dispatches each tick once.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class Scheduler {
	readonly #options: SchedulerOptions;
	readonly #timers = new Set<ReturnType<typeof setTimeout>>();
	#running = false;

	constructor(options: SchedulerOptions = {}) {
		this.#options = options;
	}

	/**
	 * The scheduled jobs of the registry.
	 * @author Axel Nana <axel.nana@workbud.com>
	 */
	public static jobs(): ScheduledJob[] {
		return JobRegistry.all().flatMap(({ name, jobClass }) =>
			schedulesOf(jobClass).map((schedule) => ({ name, jobClass, schedule }))
		);
	}

	/**
	 * The scheduled jobs whose expression is exactly the given one, such as the cron of a
	 * Cloudflare cron trigger.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param cron The cron expression.
	 */
	public static jobsFor(cron: string): ScheduledJob[] {
		return Scheduler.jobs().filter(({ schedule }) => schedule.cron.expression === cron);
	}

	/**
	 * Dispatches a scheduled job: once, or once per case of a fan-out schedule.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param job The scheduled job.
	 * @param at The tick. Defaults to now; it is taken to the minute, in UTC.
	 * @returns The number of jobs dispatched.
	 */
	public static async dispatch(job: ScheduledJob, at: Date = new Date()): Promise<number> {
		const { schedule, jobClass, name } = job;
		if (schedule.fanOut === undefined) {
			await Heracles.dispatch(jobClass, schedule.args as never);
			return 1;
		}
		const tick = new Date(Math.floor(at.getTime() / 60_000) * 60_000);
		const select = (jobClass as unknown as Record<string, (tick: Date) => unknown>)[
			schedule.fanOut
		]!;
		const cases = (await select.call(jobClass, tick)) as unknown[];
		for (const selected of cases) {
			await Heracles.dispatch(jobClass, [...schedule.args, selected] as never, {
				dispatchId: Scheduler.dispatchIdOf(name, schedule.key(selected), tick)
			});
		}
		return cases.length;
	}

	/**
	 * The dispatch id of a case of a fan-out schedule: the same for one job, case and tick.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param job The job name.
	 * @param key The key of the case.
	 * @param tick The tick.
	 */
	public static dispatchIdOf(job: string, key: string, tick: Date): string {
		return `schedule:${job}:${key}@${tick.toISOString()}`;
	}

	/** Whether the scheduler is running. */
	public get running(): boolean {
		return this.#running;
	}

	/**
	 * Plans the next tick of every scheduled job.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @returns The scheduled jobs.
	 */
	public start(): ScheduledJob[] {
		if (this.#running) return Scheduler.jobs();
		this.#running = true;
		const jobs = Scheduler.jobs();
		for (const job of jobs) this.#plan(job);
		return jobs;
	}

	/** Cancels the planned ticks. */
	public stop(): void {
		this.#running = false;
		for (const timer of this.#timers) clearTimeout(timer);
		this.#timers.clear();
	}

	#plan(job: ScheduledJob, after = new Date()): void {
		if (!this.#running) return;
		const at = Cron.next(job.schedule.cron, after);
		const wait = at.getTime() - Date.now();
		const timer = setTimeout(
			() => {
				this.#timers.delete(timer);
				if (wait > MAX_WAIT) return this.#plan(job, new Date(at.getTime() - 60_000));
				this.#plan(job, at);
				void this.#tick(job, at);
			},
			Math.max(0, Math.min(wait, MAX_WAIT))
		);
		this.#timers.add(timer);
	}

	async #tick(job: ScheduledJob, at: Date): Promise<void> {
		try {
			if (this.#options.redis !== undefined && this.#options.redis !== false) {
				const key = `heracles:schedule:${job.name}:${job.schedule.cron.expression}:${at.toISOString()}`;
				const ttl = String(this.#options.lockTtl ?? 60_000);
				const taken = await Redis.getConnection(this.#options.redis).send('SET', [
					key,
					'1',
					'NX',
					'PX',
					ttl
				]);
				if (taken !== 'OK') return;
			}
			await Scheduler.dispatch(job, at);
		} catch (error) {
			getLogger().error('Could not dispatch a scheduled job', {
				job: job.name,
				cron: job.schedule.cron.expression,
				at: at.toISOString(),
				error
			});
		}
	}
}
