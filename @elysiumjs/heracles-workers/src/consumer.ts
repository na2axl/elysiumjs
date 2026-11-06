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

/** Whether a queue message carries a Heracles job. */
export const isJobMessage = (body: unknown): body is TransportProcessMessage =>
	typeof body === 'object' &&
	body !== null &&
	(body as { type?: unknown }).type === 'job:process' &&
	typeof (body as { job?: unknown }).job === 'string';

/**
 * Runs the Heracles job a queue message carries, in its module's context. A completed job is
 * acked. A failed one is retried after its `retryDelay` while its attempts stay within
 * `maxRetries`, and acked (and logged) after that. A message for an unknown job is logged and
 * acked. Messages that carry no job are left to the other consumers.
 * @author Axel Nana <axel.nana@workbud.com>
 * @param message The queue message.
 */
export const runJobMessage = async (message: WorkersQueueMessage): Promise<void> => {
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

	logger.error('A Heracles job failed after its last retry', {
		job: body.job,
		jobId: body.jobId,
		attempts: message.attempts,
		error: job.lastError
	});
	message.ack();
};
