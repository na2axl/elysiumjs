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

import { getLogger, Metadata } from '@elysiumjs/core';
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
};

/**
 * A schedule of a job class.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type JobSchedule = { readonly cron: CronSchedule; readonly args: unknown[] };

/**
 * Dispatches a job on a cron schedule, in UTC. On Bun and Node.js, the `heracles:schedule`
 * command runs the {@link Scheduler}; on Cloudflare Workers, `HeraclesWorkersModule`
 * (`@elysiumjs/heracles-workers`) dispatches the jobs whose expression is the one of the cron
 * trigger, so list the same expression in the wrangler config. A job can have several schedules.
 * @author Axel Nana <axel.nana@workbud.com>
 * @param cron The cron expression (5 fields, or an alias such as `@daily`).
 * @param options The arguments of the dispatch.
 * @throws {InvalidCronError} When the expression is not valid.
 * @example
 * ```ts
 * @Job.register({ queue: 'default' })
 * @Schedule('0 3 * * *')
 * class PurgeExpiredSessions extends Job {
 * 	protected async execute() {}
 * }
 * ```
 */
export const Schedule =
	(cron: string, options: ScheduleOptions = {}) =>
	(target: Function): void => {
		const schedules: JobSchedule[] = Metadata.getOwn(SCHEDULES, target) ?? [];
		Metadata.define(
			SCHEDULES,
			[...schedules, { cron: Cron.parse(cron), args: options.args ?? [] }],
			target
		);
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
	 * Dispatches a scheduled job.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param job The scheduled job.
	 */
	public static async dispatch(job: ScheduledJob): Promise<void> {
		await Heracles.dispatch(job.jobClass, job.schedule.args as never);
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
			await Scheduler.dispatch(job);
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
