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

import type { JobClass, JobDispatchOptions } from '@elysiumjs/heracles';
import type { OutboxEffect } from './stores';

import { Heracles, JobRegistry } from '@elysiumjs/heracles';

import { registerEffect } from './command';

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
 * An outbox effect that dispatches a Heracles job once the command commits, with the retries of
 * the outbox until the job is queued.
 * @author Axel Nana <axel.nana@workbud.com>
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
