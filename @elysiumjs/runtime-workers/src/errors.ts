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

import { ElysiumError } from '@elysiumjs/olympus';

/**
 * Thrown when a binding is read outside a Worker invocation.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class OutsideInvocationError extends ElysiumError {
	constructor(public readonly what: string) {
		super(
			`${what} is only available while the Worker handles a request, a queue batch or a scheduled event.`
		);
	}
}

/**
 * Thrown when the Worker has no binding with the requested name.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class BindingNotFoundError extends ElysiumError {
	constructor(public readonly binding: string) {
		super(`The Worker has no binding named "${binding}". Declare it in the wrangler config.`);
	}
}

/**
 * Thrown when a queue batch or a scheduled event reaches the Worker and no service handles it.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class NoWorkersHandlerError extends ElysiumError {
	constructor(
		public readonly kind: 'queue' | 'cron',
		public readonly key: string
	) {
		super(
			kind === 'queue'
				? `No service consumes the queue "${key}". Add @Workers.queue('${key}') to a method of a module service.`
				: `No service handles the cron "${key}". Add @Workers.cron('${key}') to a method of a module service.`
		);
	}
}

/**
 * Thrown when the Worker is created and two service methods consume the same queue. A queue has
 * one consumer, so that every message is acked or retried by one decision; `*` handlers are not
 * counted.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class DuplicateQueueConsumerError extends ElysiumError {
	constructor(
		public readonly queue: string,
		public readonly consumers: string[]
	) {
		super(`The queue "${queue}" has more than one consumer: ${consumers.join(', ')}. Keep one.`);
	}
}
