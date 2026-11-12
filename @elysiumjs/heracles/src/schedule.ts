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

import type { CronSchedule } from './cron';
import type { JobClass } from './job';

import {
	Background,
	Clock,
	ElysiumError,
	getLogger,
	Metadata,
	ModuleContext,
	Service
} from '@elysiumjs/core';
import { Redis } from '@elysiumjs/redis';

import { Cron } from './cron';
import { Heracles } from './heracles';
import { JobRegistry } from './registry';

const SCHEDULES = Symbol.for('elysium:heracles:Schedules');

/**
 * Options of {@link Scheduler.job}.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type ScheduleOptions = {
	/** The arguments the job is dispatched with. */
	args?: unknown[];
};

/**
 * Raised when two scheduler classes have the same name.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class DuplicateSchedulerError extends ElysiumError {
	constructor(name: string) {
		super(`A scheduler named "${name}" is already registered.`);
	}
}

/**
 * A schedule of a job class, or of a scheduler class that fans out its job.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type JobSchedule = {
	readonly cron: CronSchedule;
	/** The arguments of a job dispatched once per tick. */
	readonly args: unknown[];
	/** The scheduler class that selects the jobs of a tick. */
	readonly scheduler?: SchedulerClass;
};

/**
 * The schedules of a job class.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @param jobClass The job class.
 */
export const schedulesOf = (jobClass: Function): readonly JobSchedule[] =>
	Metadata.getOwn(SCHEDULES, jobClass) ?? [];

/**
 * A scheduled job, with one of its schedules. For a scheduler class, `name` is the name of the
 * scheduler.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type ScheduledJob = { name: string; jobClass: JobClass<any, any>; schedule: JobSchedule };

/**
 * A job a scheduler dispatches: the key that names it in its dispatch id, and the arguments of
 * the job.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type FanOutCase<TJob extends JobClass<any, any> = JobClass<any, any>> = {
	key: string;
	args: ConstructorParameters<TJob>;
};

/**
 * Properties of {@link Scheduler.register}.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type SchedulerProps<TJob extends JobClass<any, any> = JobClass<any, any>> = {
	/** The cron expression (5 fields, or an alias such as `@daily`), in UTC. */
	cron: string;
	/** The job class the scheduler dispatches, marked with `@Job.register()`. */
	job: TJob;
	/** The name of the scheduler, in dispatch ids. Defaults to the class name. */
	name?: string;
};

/**
 * A scheduler class.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type SchedulerClass<TJob extends JobClass<any, any> = JobClass<any, any>> = new (
	...args: any[]
) => Scheduler<TJob>;

const SCHEDULERS = new Map<string, { schedulerClass: SchedulerClass; props: SchedulerProps }>();

/** @internal Forgets the registered scheduler classes, for tests. */
export const clearSchedulers = (): void => SCHEDULERS.clear();

/**
 * Dispatches one job per case due at a cron tick, such as one billing job per invoice due, so that
 * each case retries, fails and dead-letters on its own. A scheduler is a service: its constructor
 * can inject the repositories that `fanOut()` reads. Each job has a dispatch id made of the
 * scheduler, the case key and the tick, the same however often the tick is handled, so `@Once()`
 * of `@elysiumjs/moirai/heracles` runs it once.
 *
 * The static methods run the schedules of the application: {@link ScheduleRunner} and
 * `HeraclesWorkersModule` call them.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @example
 * ```ts
 * @Scheduler.register({ cron: '0 6 * * *', job: BillInvoice })
 * class DailyBilling extends Scheduler<typeof BillInvoice> {
 * 	constructor(@Service.inject() private readonly invoices: InvoiceRepository) {
 * 		super();
 * 	}
 *
 * 	public async fanOut(tick: Date) {
 * 		const due = await this.invoices.dueAt(tick);
 * 		return due.map((invoice) => ({ key: invoice.id, args: [invoice.id] }));
 * 	}
 * }
 * ```
 */
export abstract class Scheduler<TJob extends JobClass<any, any> = JobClass<any, any>> {
	/**
	 * Dispatches a job on a cron schedule, in UTC, with fixed arguments. On Bun and Node.js, the
	 * `heracles:schedule` command runs the {@link ScheduleRunner}; on Cloudflare Workers,
	 * `HeraclesWorkersModule` (`@elysiumjs/heracles-workers`) dispatches the jobs whose expression is
	 * the one of the cron trigger, so list the same expression in the wrangler config. A job can have
	 * several schedules. To dispatch one job per case due at a tick, extend {@link Scheduler}.
	 * @author Axel Nana <ax.lnana@outlook.com>
	 * @param cron The cron expression (5 fields, or an alias such as `@daily`).
	 * @param options The arguments of the dispatch.
	 * @throws {InvalidCronError} When the expression is not valid.
	 * @example
	 * ```ts
	 * @Job.register({ queue: 'default' })
	 * @Scheduler.job('0 3 * * *')
	 * class PurgeExpiredSessions extends Job {
	 * 	protected async execute() {}
	 * }
	 * ```
	 */
	public static job(cron: string, options: ScheduleOptions = {}) {
		const schedule: JobSchedule = { cron: Cron.parse(cron), args: options.args ?? [] };
		return (target: Function): void => {
			const schedules: JobSchedule[] = Metadata.getOwn(SCHEDULES, target) ?? [];
			Metadata.define(SCHEDULES, [...schedules, schedule], target);
		};
	}

	/**
	 * Marks a class as a scheduler of a job.
	 * @param props The cron expression, the job and the name of the scheduler.
	 * @throws {InvalidCronError} When the expression is not valid.
	 * @throws {DuplicateSchedulerError} When another scheduler has the same name.
	 */
	public static register<TJob extends JobClass<any, any>>(props: SchedulerProps<TJob>) {
		const cron = Cron.parse(props.cron);
		return (target: SchedulerClass<TJob>): void => {
			const name = props.name ?? target.name;
			if (SCHEDULERS.has(name)) throw new DuplicateSchedulerError(name);
			SCHEDULERS.set(name, {
				schedulerClass: target as SchedulerClass,
				props: { ...props, name, cron: cron.expression } as SchedulerProps
			});
		};
	}

	/**
	 * The scheduled jobs of the application: the jobs of the registry marked with `@Scheduler.job()`,
	 * and the scheduler classes.
	 * @author Axel Nana <ax.lnana@outlook.com>
	 */
	public static jobs(): ScheduledJob[] {
		const scheduled: ScheduledJob[] = JobRegistry.all().flatMap(({ name, jobClass }) =>
			schedulesOf(jobClass).map((schedule) => ({ name, jobClass, schedule }))
		);
		for (const [name, { schedulerClass, props }] of SCHEDULERS) {
			scheduled.push({
				name,
				jobClass: props.job,
				schedule: { cron: Cron.parse(props.cron), args: [], scheduler: schedulerClass }
			});
		}
		return scheduled;
	}

	/**
	 * The distinct cron expressions of the scheduled jobs, sorted: the cron triggers a Cloudflare
	 * Worker needs, since a trigger runs the jobs whose expression is exactly its own.
	 * @author Axel Nana <ax.lnana@outlook.com>
	 */
	public static crons(): string[] {
		return [...new Set(Scheduler.jobs().map(({ schedule }) => schedule.cron.expression))].sort();
	}

	/**
	 * Compares declared cron triggers, such as the `triggers.crons` of a `wrangler.jsonc`, with
	 * the cron expressions of the scheduled jobs.
	 * @author Axel Nana <ax.lnana@outlook.com>
	 * @param declared The declared cron triggers.
	 * @returns The expressions no trigger runs (`missing`) and the triggers no job uses (`extra`).
	 */
	public static compareCrons(declared: readonly string[]): { missing: string[]; extra: string[] } {
		const crons = Scheduler.crons();
		return {
			missing: crons.filter((cron) => !declared.includes(cron)),
			extra: [...new Set(declared)].filter((cron) => !crons.includes(cron)).sort()
		};
	}

	/**
	 * The scheduled jobs whose expression is exactly the given one, such as the cron of a
	 * Cloudflare cron trigger.
	 * @author Axel Nana <ax.lnana@outlook.com>
	 * @param cron The cron expression.
	 */
	public static jobsFor(cron: string): ScheduledJob[] {
		return Scheduler.jobs().filter(({ schedule }) => schedule.cron.expression === cron);
	}

	/**
	 * Dispatches a scheduled job: once, or once per case its scheduler selects.
	 * @author Axel Nana <ax.lnana@outlook.com>
	 * @param job The scheduled job.
	 * @param at The tick. Defaults to now; it is taken to the minute, in UTC.
	 * @returns The number of jobs dispatched.
	 */
	public static async dispatch(job: ScheduledJob, at: Date = Clock.now()): Promise<number> {
		const { schedule, jobClass, name } = job;
		if (!schedule.scheduler) {
			await Heracles.dispatch(jobClass, schedule.args as never);
			return 1;
		}
		const tick = new Date(Math.floor(at.getTime() / 60_000) * 60_000);
		const owner = schedule.scheduler;
		// The scheduler is a service of the module that declares its job: it is made and fans out
		// there, so that it sees that module's services, whoever dispatches the tick.
		const module = JobRegistry.all().find((entry) => entry.jobClass === jobClass)?.module;
		// It runs in the background scopes of the application, like the jobs it dispatches.
		const fanOut = () =>
			Background.run({ kind: 'schedule', name }, async () => {
				const scheduler =
					(Service.exists(owner) ? Service.get(owner) : null) ?? Service.make(owner);
				return scheduler.fanOut(tick);
			});
		const cases =
			module && module !== ModuleContext.current()
				? await ModuleContext.run(module, fanOut)
				: await fanOut();
		for (const { key, args } of cases) {
			await Heracles.dispatch(jobClass, args as never, {
				dispatchId: Scheduler.dispatchIdOf(name, key, tick)
			});
		}
		return cases.length;
	}

	/**
	 * The dispatch id of a job of a scheduler: the same for one scheduler, case and tick.
	 * @author Axel Nana <ax.lnana@outlook.com>
	 * @param scheduler The name of the scheduler.
	 * @param key The key of the case.
	 * @param tick The tick.
	 */
	public static dispatchIdOf(scheduler: string, key: string, tick: Date): string {
		return `schedule:${scheduler}:${key}@${tick.toISOString()}`;
	}

	/**
	 * Selects the jobs due at a tick.
	 * @param tick The tick, in UTC, to the minute.
	 * @returns One case per job to dispatch, with its key and the arguments of the job.
	 */
	public abstract fanOut(tick: Date): Promise<FanOutCase<TJob>[]> | FanOutCase<TJob>[];
}

/**
 * Options of the {@link ScheduleRunner}.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type ScheduleRunnerOptions = {
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
 * Dispatches the scheduled jobs at their times, with in-process timers. With a Redis connection,
 * each tick takes a lock first, so that running it in several processes dispatches each tick once.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class ScheduleRunner {
	readonly #options: ScheduleRunnerOptions;
	readonly #timers = new Set<ReturnType<typeof setTimeout>>();
	#running = false;

	constructor(options: ScheduleRunnerOptions = {}) {
		this.#options = options;
	}

	/** Whether the scheduler is running. */
	public get running(): boolean {
		return this.#running;
	}

	/**
	 * Plans the next tick of every scheduled job.
	 * @author Axel Nana <ax.lnana@outlook.com>
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
