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

import type { Job, JobClass, JobDispatchOptions } from '../heracles/index';
import type { OutboxEffect } from './stores';

import {
	DATABASE_TRANSACTION_SERVICE,
	ElysiumError,
	ModuleContext,
	Service
} from '../index';
import { Heracles, JobRegistry } from '../heracles/index';
import { UnitOfWork } from '../mnemosyne/index';

import { Inbox, registerEffect } from './outbox';

/** The kind of the effects that dispatch a Heracles job. */
export const HERACLES_JOB_EFFECT = 'heracles.job';

type JobPayload = { job: string; args: unknown[]; options?: JobDispatchOptions };

registerEffect(HERACLES_JOB_EFFECT, async (payload) => {
	const { job, args, options } = payload as JobPayload;
	const entry = JobRegistry.get(job);
	if (!entry) throw new Error(`No Heracles job is registered as ${job}.`);
	await Heracles.dispatch(entry.jobClass, args as never, options);
});

/**
 * An outbox effect that dispatches a Heracles job once the action commits, with the retries of
 * the outbox until the job is queued.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @param jobClass The job class, registered in a module's `jobs`.
 * @param args The arguments of the job, JSON-safe.
 * @param options The dispatch options.
 * @example
 * ```ts
 * await Outbox.enqueue(job(SendReceiptJob, [order.id]));
 * ```
 */
export const job = <TClass extends JobClass<any>>(
	jobClass: TClass,
	args: ConstructorParameters<TClass>,
	options?: JobDispatchOptions
): OutboxEffect => {
	const name = JobRegistry.all().find((entry) => entry.jobClass === jobClass)?.name;
	if (!name) throw new Error(`${jobClass.name} is not registered in a module's jobs.`);
	return { kind: HERACLES_JOB_EFFECT, payload: { job: name, args, options } satisfies JobPayload };
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
