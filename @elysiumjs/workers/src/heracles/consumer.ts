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

import type { TransportProcessMessage } from '@elysiumjs/olympus/heracles';
import type { WorkersQueueMessage } from '../index';

import { getLogger, ModuleContext, Service } from '@elysiumjs/olympus';
import {
	JobRegistry,
	JobStatus,
	openJobArgs,
	Queue,
	QUEUES_SERVICE,
	WithId
} from '@elysiumjs/olympus/heracles';

import { Workers } from '../index';

/** Whether a queue message carries a Heracles job. */
export const isJobMessage = (body: unknown): body is TransportProcessMessage =>
	typeof body === 'object' &&
	body !== null &&
	(body as { type?: unknown }).type === 'job:process' &&
	typeof (body as { job?: unknown }).job === 'string';

/**
 * A job that failed its last retry.
 * @author Axel Nana <ax.lnana@outlook.com>
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

/** What happens to the jobs that failed their last retry, besides their queue's dead letter queue. */
export type DeadLetterOptions = {
	/** Called with each one. */
	onDead?: (dead: DeadJob) => unknown;
};

/** The dead letter queue binding set in the `transportOptions` of a Heracles queue, if any. */
const deadLetterQueueOf = async (name: string): Promise<string | undefined> => {
	if (Service.exists(QUEUES_SERVICE)) await Service.resolve(QUEUES_SERVICE);
	if (!Queue.exists(name)) return undefined;
	const binding: unknown = Queue.get(name).getOptions().transportOptions?.deadLetterQueue;
	return typeof binding === 'string' && binding !== '' ? binding : undefined;
};

/** Sends a dead job to its queue's dead letter queue and calls the hook; a failure of either is logged. */
const bury = async (dead: DeadJob, options: DeadLetterOptions): Promise<void> => {
	const logger = getLogger();
	logger.error('A Heracles job failed after its last retry', {
		job: dead.job,
		jobId: dead.jobId,
		attempts: dead.attempts,
		error: dead.error
	});
	const deadLetterQueue = await deadLetterQueueOf(dead.queue);
	if (deadLetterQueue) {
		try {
			const queue = Workers.binding<{ send(body: unknown): Promise<void> }>(deadLetterQueue);
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
				deadLetterQueue,
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
 * `maxRetries`; after that it goes to the `deadLetterQueue` of its queue's `transportOptions` and
 * to the `onDead` hook, when set, and is acked. The arguments of an encrypted job that do not
 * decrypt fail the same way, without running the job. A message for an unknown job is logged and
 * acked. Messages that carry no job are left to the other consumers.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @param message The queue message.
 * @param options What else happens to the jobs that failed their last retry.
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

	// Retries within maxRetries, then goes to the dead letters.
	const fail = async (error: unknown): Promise<void> => {
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
				error,
				message: body
			},
			options
		);
		message.ack();
	};

	let args: unknown[];
	try {
		args = await openJobArgs(entry.jobClass, body.job, body.args);
	} catch (error) {
		// Such as a consumer that has not received the current key yet: retried like a failure.
		logger.error('The arguments of a Heracles job could not be read', {
			job: body.job,
			jobId: body.jobId,
			error: error instanceof Error ? error.message : String(error)
		});
		await fail(error);
		return;
	}

	const job = ModuleContext.run(
		entry.module,
		() => new (WithId(entry.jobClass, body.jobId, body.dispatchId))(...args)
	);
	job.queueName = body.queue;
	await ModuleContext.run(entry.module, () => job.run());

	if (job.status !== JobStatus.FAILED) {
		message.ack();
		return;
	}

	await fail(job.lastError);
};
