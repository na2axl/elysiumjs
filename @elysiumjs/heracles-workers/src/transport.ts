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

import type { JobStatusInfo, Transport, TransportEvent } from '@elysiumjs/olympus/heracles';

import { ElysiumError, getLogger } from '@elysiumjs/olympus';
import { Workers } from '@elysiumjs/runtime-workers';

/**
 * A Cloudflare Queue producer binding.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export interface WorkersQueueBinding {
	send(body: unknown, options?: { delaySeconds?: number }): Promise<void>;
}

/**
 * Options of {@link CloudflareQueueTransport}, set as the `transportOptions` of a queue.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type CloudflareQueueTransportOptions = {
	/** The name of the queue producer binding, as declared in the wrangler config. */
	binding: string;
	/**
	 * The queue binding that receives the jobs of this queue that failed their last retry, as they
	 * were sent with a `failure` member, so that they can be looked at and sent again. Without it,
	 * they are logged and dropped.
	 */
	deadLetterQueue?: string;
};

/** Cloudflare Queues delay a message by 12 hours at most. */
const MAX_DELAY_SECONDS = 12 * 60 * 60;

/**
 * Sends the jobs of a Heracles queue to a Cloudflare Queue. The Worker consumes them with
 * `HeraclesWorkersModule`. Cloudflare Queues keep no job status and cannot cancel a message, so
 * `getJobStatus()` throws and cancellations are logged and dropped. A job scheduled for later is
 * delayed with `delaySeconds`, up to 12 hours.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @example
 * ```ts
 * HeraclesModule.with({
 * 	queues: {
 * 		emails: {
 * 			transport: CloudflareQueueTransport,
 * 			transportOptions: { binding: 'EMAILS_QUEUE', deadLetterQueue: 'EMAILS_DLQ' }
 * 		}
 * 	}
 * });
 * ```
 */
export class CloudflareQueueTransport implements Transport {
	readonly #binding: string;

	constructor(_mode: unknown, options?: Record<string, any>) {
		const binding = (options as CloudflareQueueTransportOptions | undefined)?.binding;
		if (!binding) {
			throw new ElysiumError(
				'CloudflareQueueTransport needs the `binding` of a queue in its transportOptions.'
			);
		}
		this.#binding = binding;
	}

	public start(): void {}

	public stop(): void {}

	public async send(message: TransportEvent): Promise<void> {
		if (message.type !== 'job:process') {
			getLogger().warn('Cloudflare Queues cannot run this Heracles message; it is dropped', {
				type: message.type,
				binding: this.#binding
			});
			return;
		}
		const scheduledFor = message.options?.scheduledFor;
		const delay = scheduledFor ? Math.ceil((Date.parse(scheduledFor) - Date.now()) / 1000) : 0;
		const queue = Workers.binding<WorkersQueueBinding>(this.#binding);
		await queue.send(
			message,
			delay > 0 ? { delaySeconds: Math.min(delay, MAX_DELAY_SECONDS) } : undefined
		);
	}

	public onMessage(): void {}

	public getJobStatus(): Promise<JobStatusInfo> {
		return Promise.reject(new ElysiumError('Cloudflare Queues keep no job status.'));
	}

	public async registerWorker(): Promise<void> {}

	public async unregisterWorker(): Promise<void> {}

	public async updateJobStatus(): Promise<void> {}
}
