// Copyright (c) 2025-present Axel Nana <ax.lnana@outlook.com>. All rights reserved.
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

import type { Transport, TransportEvent } from '../src/transport';

import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test';

import { Heracles } from '../src/heracles';
import { Job } from '../src/job';
import { Queue } from '../src/queue';
import { TransportMode } from '../src/transport';

// Mock Transport
class MockTransport implements Transport {
	start = mock(async () => {});
	stop = mock(async () => {});
	send = mock(async (_msg: TransportEvent) => {});
	onMessage = mock((_handler: any) => {});
	getJobStatus = mock(async () => null as any);
	registerWorker = mock(async () => {});
	unregisterWorker = mock(async () => {});
	updateJobStatus = mock(async () => {});

	constructor(_mode: TransportMode, _options?: Record<string, any>) {}
}

describe('Heracles.dispatch', () => {
	let queueCounter = 0;

	function uniqueQueueName(): string {
		return `heracles-queue-${Date.now()}-${++queueCounter}`;
	}

	afterEach(() => {
		(Queue as any).queues?.clear?.();
	});

	it('should throw for undecorated job class', async () => {
		class UndecoratedJob extends Job {
			protected async execute(): Promise<void> {}
		}

		await expect(Heracles.dispatch(UndecoratedJob as any)).rejects.toThrow(
			'is not marked with @Job.register()'
		);
	});

	it('should throw when queue does not exist', async () => {
		@Job.register({ name: `NoQueueJob-${Date.now()}`, queue: 'nonexistent-queue' })
		class NoQueueJob extends Job {
			protected async execute(): Promise<void> {}
		}

		await expect(Heracles.dispatch(NoQueueJob as any)).rejects.toThrow(
			'does not exist'
		);
	});

	it('should dispatch to the correct queue', async () => {
		const queueName = uniqueQueueName();

		@Job.register({ name: `DispatchJob-${queueName}`, queue: queueName })
		class DispatchJob extends Job {
			protected async execute(): Promise<void> {}
		}

		// Create the queue with mock transport
		const queue = Queue.get(queueName, { transport: MockTransport });
		const dispatchSpy = spyOn(queue, 'dispatch');

		const result = await Heracles.dispatch(DispatchJob as any);

		expect(result).toBeDefined();
		expect(result.jobId).toBeDefined();
		expect(result.dispatchId).toBeDefined();
		expect(dispatchSpy).toHaveBeenCalled();
	});

	it('should forward metadata options to queue.dispatch', async () => {
		const queueName = uniqueQueueName();

		@Job.register({
			name: `MetaJob-${queueName}`,
			queue: queueName,
			priority: 5,
			maxRetries: 3,
			retryDelay: 2000
		})
		class MetaJob extends Job {
			protected async execute(): Promise<void> {}
		}

		const queue = Queue.get(queueName, { transport: MockTransport });
		const dispatchSpy = spyOn(queue, 'dispatch');

		await Heracles.dispatch(MetaJob as any);

		const options = dispatchSpy.mock.calls[0][3];
		expect(options.priority).toBe(5);
		expect(options.maxRetries).toBe(3);
		expect(options.retryDelay).toBe(2000);
	});

	it('should allow overriding options at dispatch time', async () => {
		const queueName = uniqueQueueName();

		@Job.register({
			name: `OverrideJob-${queueName}`,
			queue: queueName,
			priority: 5
		})
		class OverrideJob extends Job {
			protected async execute(): Promise<void> {}
		}

		const queue = Queue.get(queueName, { transport: MockTransport });
		const dispatchSpy = spyOn(queue, 'dispatch');

		await Heracles.dispatch(OverrideJob as any, [], { priority: 1 });

		const options = dispatchSpy.mock.calls[0][3];
		expect(options.priority).toBe(1);
	});

	it('should pass constructor args to queue.dispatch', async () => {
		const queueName = uniqueQueueName();

		@Job.register({ name: `ArgsJob-${queueName}`, queue: queueName })
		class ArgsJob extends Job {
			constructor(public input: string) {
				super();
			}

			protected async execute(): Promise<void> {}
		}

		const queue = Queue.get(queueName, { transport: MockTransport });
		const dispatchSpy = spyOn(queue, 'dispatch');

		await Heracles.dispatch(ArgsJob as any, ['hello']);

		const args = dispatchSpy.mock.calls[0][2];
		expect(args).toEqual(['hello']);
	});
});
