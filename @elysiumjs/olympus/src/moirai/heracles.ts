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

import type { JobClass, JobDispatchOptions } from '../heracles/index';
import type { QueuedRun } from './action';
import type { OutboxEffect } from './stores';

import { Heracles, Job, JobRegistry, Queue, QUEUES_SERVICE, sealJobArgs } from '../heracles/index';
import {
	DATABASE_TRANSACTION_SERVICE,
	ElysiumError,
	getLogger,
	ModuleContext,
	Service
} from '../index';
import { UnitOfWork } from '../mnemosyne/index';
import { runQueuedAction, setActionQueue } from './action';
import { MOIRAI_ACTION_JOB, MOIRAI_OUTBOX_STORE } from './config';
import { QueuedActionsUnavailableError } from './errors';
import { uuidv7 } from './ids';
import { Inbox, Outbox, registerEffect } from './outbox';

/** The kind of the effects that dispatch a Heracles job. */
export const HERACLES_JOB_EFFECT = 'heracles.job';

type JobPayload = { job: string; args: unknown[]; options?: JobDispatchOptions };

registerEffect(HERACLES_JOB_EFFECT, async (payload) => {
	const { job, args, options } = payload as JobPayload;
	const entry = JobRegistry.get(job);
	if (!entry) throw new Error(`No Heracles job is registered as ${job}.`);
	// A stored outbox may keep the schedule as its JSON string.
	const scheduledFor = options?.scheduledFor;
	await Heracles.dispatch(
		entry.jobClass,
		args as never,
		scheduledFor ? { ...options, scheduledFor: new Date(scheduledFor) } : options
	);
});

/**
 * An outbox effect that dispatches a Heracles job once the action commits, with the retries of
 * the outbox until the job is queued. The arguments of an encrypted job are encrypted here, so
 * that the outbox does not store them in clear either.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @param jobClass The job class, registered in a module's `jobs`.
 * @param args The arguments of the job, JSON-safe.
 * @param options The dispatch options.
 * @throws {MissingJobCipherError} When the job is encrypted and no cipher is configured.
 * @example
 * ```ts
 * await Outbox.enqueue(job(SendReceiptJob, [order.id]));
 * ```
 */
export const job = async <TClass extends JobClass<any>>(
	jobClass: TClass,
	args: ConstructorParameters<TClass>,
	options?: JobDispatchOptions
): Promise<OutboxEffect> => {
	const name = JobRegistry.all().find((entry) => entry.jobClass === jobClass)?.name;
	if (!name) throw new Error(`${jobClass.name} is not registered in a module's jobs.`);
	const carried = await sealJobArgs(jobClass, name, args);
	return {
		kind: HERACLES_JOB_EFFECT,
		payload: { job: name, args: carried, options } satisfies JobPayload
	};
};

/**
 * Raised when `@Once()` goes on a class without an `execute()` method.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class InvalidOnceJobError extends ElysiumError {
	constructor(name: string) {
		super(`@Once() goes on a Heracles job class with an execute() method, which ${name} has not.`);
	}
}

/**
 * Runs a Heracles job once per dispatch id: its `execute()` runs in a unit of work with an inbox
 * record of the dispatch id, so a delivery that comes again, or a tick handled twice, does nothing.
 * Made for the jobs of a `Scheduler`, whose dispatch id names the scheduler, the case and the
 * tick. Without a database module, the record and the work run without a transaction.
 * @author Axel Nana <ax.lnana@outlook.com>
 * The record goes to the inbox of the module that registers the job.
 * @param options The inbox consumer. Defaults to the job name.
 * @example
 * ```ts
 * @Job.register({ queue: 'billing' })
 * @Once()
 * class BillInvoice extends Job { ... }
 * ```
 */
export const Once =
	(options: { consumer?: string } = {}) =>
	(target: Function): void => {
		const proto = target.prototype as { execute?: (...args: unknown[]) => unknown };
		const execute = proto.execute;
		if (typeof execute !== 'function') throw new InvalidOnceJobError(target.name);
		proto.execute = async function (this: Job, ...args: unknown[]) {
			const entry = JobRegistry.all().find((item) => item.jobClass === this.constructor);
			const consumer = options.consumer ?? entry?.name ?? target.name;
			const work = () =>
				Inbox.once({ messageId: this.dispatchId, consumer }, async () => {
					await execute.apply(this, args);
				});
			const run = () =>
				Service.exists(DATABASE_TRANSACTION_SERVICE) ? UnitOfWork.run(work) : work();
			await (entry && entry.module !== ModuleContext.current()
				? ModuleContext.run(entry.module, run)
				: run());
		};
	};

/**
 * The job that runs the calls of `Moirai.enqueue()`: it runs the action through the same path as
 * `Moirai.execute()`, with its unit of work, retries, idempotency and outbox, in the module of the
 * action. List it in the `jobs` of one module, next to `HeraclesModule`, in the processes that
 * queue actions and in those that run them; the latter must import the actions too.
 *
 * A refusal of the handler ends the job: it is logged, not retried. A thrown error fails the job,
 * which Heracles retries within the `maxRetries` of the queue (none for an action registered with
 * `retry: false`). A job may run more than once, so give an action that must not an idempotency
 * key: a second run replays the stored response.
 *
 * The job trusts its queue: `authorize` ran when the call was queued, so anything that can write
 * to the queue can run any registered action.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @example
 * ```ts
 * @Module.register({ jobs: [ActionJob] })
 * class AppModule extends Module {}
 *
 * await Moirai.enqueue(SendDigest, { userId }, { queue: 'mail' });
 * ```
 */
@Job.register({ name: MOIRAI_ACTION_JOB })
export class ActionJob extends Job {
	public static override readonly description: string = 'Runs a queued action.';

	constructor(private readonly call: QueuedRun) {
		super();
	}

	protected async execute(): Promise<void> {
		const result = await runQueuedAction(this.call);
		if (!result.check()) {
			getLogger().warn('A queued action was refused', {
				action: this.call.action,
				error: result.error.message
			});
		}
	}
}

setActionQueue(async (run, { queue, scheduledFor, priority, maxRetries }) => {
	// Resolving the queues also initialises HeraclesModule, which fills the job registry.
	if (Service.exists(QUEUES_SERVICE)) await Service.resolve(QUEUES_SERVICE);
	if (!JobRegistry.all().some((entry) => entry.jobClass === ActionJob)) {
		throw new QueuedActionsUnavailableError(run.action);
	}
	if (!Queue.exists(queue)) {
		throw new ElysiumError(`Queue ${queue} does not exist: configure it in HeraclesModule.`);
	}
	// The ids are known before the dispatch, which may wait for the unit of work to commit.
	const ids = { jobId: ActionJob.generateJobId(), dispatchId: `dispatch_${uuidv7()}` };
	const options: JobDispatchOptions = {
		queue,
		...ids,
		...(scheduledFor ? { scheduledFor } : {}),
		...(priority === undefined ? {} : { priority }),
		...(maxRetries === undefined ? {} : { maxRetries })
	};
	if (!UnitOfWork.active()) {
		await Heracles.dispatch(ActionJob, [run], options);
	} else if (Service.get(MOIRAI_OUTBOX_STORE)) {
		// In a unit of work, the job is dispatched once it commits, and only then.
		await Outbox.enqueue(job(ActionJob, [run], options));
	} else {
		await UnitOfWork.afterCommit(async () => {
			await Heracles.dispatch(ActionJob, [run], options);
		});
	}
	return ids;
});
