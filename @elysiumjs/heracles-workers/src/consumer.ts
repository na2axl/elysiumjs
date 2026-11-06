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

import type { TransportProcessMessage } from '@elysiumjs/heracles';
import type { WorkersQueueMessage } from '@elysiumjs/runtime-workers';

import { getLogger, ModuleContext } from '@elysiumjs/core';
import { JobRegistry, JobStatus, WithId } from '@elysiumjs/heracles';
import { Workers } from '@elysiumjs/runtime-workers';

/** Whether a queue message carries a Heracles job. */
export const isJobMessage = (body: unknown): body is TransportProcessMessage =>
	typeof body === 'object' &&
	body !== null &&
	(body as { type?: unknown }).type === 'job:process' &&
	typeof (body as { job?: unknown }).job === 'string';

/**
 * A job that failed its last retry.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type DeadJob = {
	/** The job name. */
	job: string;
	jobId: string;
	dispatchId: string;
	/** The Heracles queue of the job. */
	queue: string;
	/** The deliveries of the message, the last one included. */
	attempts: number;
	/** The last error of the job. */
	error: unknown;
	/** The message, as it was sent. */
	message: TransportProcessMessage;
};

/** Where the jobs that failed their last retry go. */
export type DeadLetterOptions = {
	/** The queue binding that receives them. */
	deadLetterQueue?: string;
	/** Called with each one. */
	onDead?: (dead: DeadJob) => unknown;
};

/** Sends a dead job to the dead letter queue and calls the hook; a failure of either is logged. */
const bury = async (dead: DeadJob, options: DeadLetterOptions): Promise<void> => {
	const logger = getLogger();
	logger.error('A Heracles job failed after its last retry', {
		job: dead.job,
		jobId: dead.jobId,
		attempts: dead.attempts,
		error: dead.error
	});
	if (options.deadLetterQueue) {
		try {
			const queue = Workers.binding<{ send(body: unknown): Promise<void> }>(
				options.deadLetterQueue
			);
			await queue.send({
				...dead.message,
				failure: {
					error: dead.error instanceof Error ? dead.error.message : String(dead.error),
					attempts: dead.attempts,
					deadAt: new Date().toISOString()
				}
			});
		} catch (error) {
			logger.error('Could not send a dead Heracles job to its dead letter queue', {
				job: dead.job,
				jobId: dead.jobId,
				error
			});
		}
	}
	if (options.onDead) {
		try {
			await options.onDead(dead);
		} catch (error) {
			logger.error('The onDead hook of Heracles failed', { job: dead.job, error });
		}
	}
};

/**
 * Runs the Heracles job a queue message carries, in its module's context. A completed job is
 * acked. A failed one is retried after its `retryDelay` while its attempts stay within
 * `maxRetries`; after that it goes to the dead letter queue and the `onDead` hook, when set, and
 * is acked. A message for an unknown job is logged and acked. Messages that carry no job are left
 * to the other consumers.
 * @author Axel Nana <axel.nana@workbud.com>
 * @param message The queue message.
 * @param options Where the jobs that failed their last retry go.
 */
export const runJobMessage = async (
	message: WorkersQueueMessage,
	options: DeadLetterOptions = {}
): Promise<void> => {
	const body = message.body;
	if (!isJobMessage(body)) return;

	const logger = getLogger();
	const entry = JobRegistry.get(body.job);
	if (!entry) {
		logger.error('No Heracles job is registered under this name', { job: body.job });
		message.ack();
		return;
	}

	const job = ModuleContext.run(
		entry.module,
		() => new (WithId(entry.jobClass, body.jobId, body.dispatchId))(...(body.args ?? []))
	);
	job.queueName = body.queue;
	await ModuleContext.run(entry.module, () => job.run());

	if (job.status !== JobStatus.FAILED) {
		message.ack();
		return;
	}

	const maxRetries = Number(body.options?.maxRetries ?? 0);
	if (message.attempts <= maxRetries) {
		const delaySeconds = Math.ceil(Number(body.options?.retryDelay ?? 0) / 1000);
		message.retry(delaySeconds > 0 ? { delaySeconds } : undefined);
		return;
	}

	await bury(
		{
			job: body.job,
			jobId: body.jobId,
			dispatchId: body.dispatchId,
			queue: body.queue,
			attempts: message.attempts,
			error: job.lastError,
			message: body
		},
		options
	);
	message.ack();
};
