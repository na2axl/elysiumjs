// Copyright (c) 2025-present Workbud Technologies Inc. All rights reserved.
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

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

import { Job } from '../src/job';
import { Queue } from '../src/queue';
import { TransportMode } from '../src/transport';

// Mock Transport class
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

// Simple test job class
@Job.register({ name: 'QueueTestJob', queue: 'default' })
class QueueTestJob extends Job {
	static readonly description = 'A queue test job';

	protected async execute(): Promise<void> {}
}

describe('Queue', () => {
	let queueCounter = 0;

	function uniqueQueueName(): string {
		return `test-queue-${Date.now()}-${++queueCounter}`;
	}

	afterEach(() => {
		// Clear internal queue registry
		(Queue as any).queues?.clear?.();
	});

	describe('static registry', () => {
		it('should report false for non-existent queue', () => {
			expect(Queue.exists('nonexistent-queue')).toBe(false);
		});

		it('should create and register a queue via get()', () => {
			const name = uniqueQueueName();
			const queue = Queue.get(name, { transport: MockTransport });

			expect(queue).toBeDefined();
			expect(queue.name).toBe(name);
			expect(Queue.exists(name)).toBe(true);
		});

		it('should return the same instance on subsequent get() calls', () => {
			const name = uniqueQueueName();
			const queue1 = Queue.get(name, { transport: MockTransport });
			const queue2 = Queue.get(name);

			expect(queue1).toBe(queue2);
		});

		it('should return all registered queues via getAll()', () => {
			const name1 = uniqueQueueName();
			const name2 = uniqueQueueName();
			Queue.get(name1, { transport: MockTransport });
			Queue.get(name2, { transport: MockTransport });

			const all = Queue.getAll();
			expect(all.has(name1)).toBe(true);
			expect(all.has(name2)).toBe(true);
		});

		it('should return a copy from getAll()', () => {
			const name = uniqueQueueName();
			Queue.get(name, { transport: MockTransport });

			const all = Queue.getAll();
			all.delete(name);

			// Original should still have it
			expect(Queue.exists(name)).toBe(true);
		});
	});

	describe('dispatch', () => {
		it('should call transport.send with job:process message', async () => {
			const name = uniqueQueueName();
			const queue = Queue.get(name, { transport: MockTransport });
			const transport = (queue as any).transport as MockTransport;

			await queue.dispatch(QueueTestJob, 'elysium.heracles.job.QueueTestJob', []);

			expect(transport.send).toHaveBeenCalled();
			const sentMessage = transport.send.mock.calls[0][0];
			expect(sentMessage.type).toBe('job:process');
			expect(sentMessage.job).toBe('elysium.heracles.job.QueueTestJob');
			expect(sentMessage.queue).toBe(name);
		});

		it('should return jobId and dispatchId', async () => {
			const name = uniqueQueueName();
			const queue = Queue.get(name, { transport: MockTransport });

			const result = await queue.dispatch(QueueTestJob, 'test-job', []);

			expect(result.jobId).toBeDefined();
			expect(result.dispatchId).toBeDefined();
		});

		it('should use provided jobId and dispatchId', async () => {
			const name = uniqueQueueName();
			const queue = Queue.get(name, { transport: MockTransport });

			const result = await queue.dispatch(QueueTestJob, 'test-job', [], {
				jobId: 'custom-job-id',
				dispatchId: 'custom-dispatch-id'
			});

			expect(result.jobId).toBe('custom-job-id');
			expect(result.dispatchId).toBe('custom-dispatch-id');
		});

		it('should re-throw when transport.send fails', async () => {
			const name = uniqueQueueName();
			const queue = Queue.get(name, { transport: MockTransport });
			const transport = (queue as any).transport as MockTransport;

			transport.send.mockRejectedValueOnce(new Error('Transport failure'));

			await expect(
				queue.dispatch(QueueTestJob, 'test-job', [])
			).rejects.toThrow('Transport failure');
		});

		it('should forward dispatch options in the message', async () => {
			const name = uniqueQueueName();
			const queue = Queue.get(name, { transport: MockTransport });
			const transport = (queue as any).transport as MockTransport;

			await queue.dispatch(QueueTestJob, 'test-job', [], {
				priority: 1,
				maxRetries: 3,
				retryDelay: 5000
			});

			const sentMessage = transport.send.mock.calls[0][0];
			expect(sentMessage.options.priority).toBe(1);
			expect(sentMessage.options.maxRetries).toBe(3);
			expect(sentMessage.options.retryDelay).toBe(5000);
		});
	});

	describe('cancelJob', () => {
		it('should call transport.send with job:cancel message', async () => {
			const name = uniqueQueueName();
			const queue = Queue.get(name, { transport: MockTransport });
			const transport = (queue as any).transport as MockTransport;

			const result = await queue.cancelJob({
				jobId: 'cancel-job-1',
				dispatchId: 'cancel-dispatch-1'
			});

			expect(result).toBe(true);
			expect(transport.send).toHaveBeenCalled();
			const sentMessage = transport.send.mock.calls[0][0];
			expect(sentMessage.type).toBe('job:cancel');
			expect(sentMessage.jobId).toBe('cancel-job-1');
		});

		it('should return false when transport.send fails', async () => {
			const name = uniqueQueueName();
			const queue = Queue.get(name, { transport: MockTransport });
			const transport = (queue as any).transport as MockTransport;

			transport.send.mockRejectedValueOnce(new Error('fail'));

			const result = await queue.cancelJob({
				jobId: 'job-1',
				dispatchId: 'dispatch-1'
			});
			expect(result).toBe(false);
		});
	});

	describe('cancelAllJobs', () => {
		it('should call transport.send with job:cancelAll message', async () => {
			const name = uniqueQueueName();
			const queue = Queue.get(name, { transport: MockTransport });
			const transport = (queue as any).transport as MockTransport;

			await queue.cancelAllJobs();

			expect(transport.send).toHaveBeenCalled();
			const sentMessage = transport.send.mock.calls[0][0];
			expect(sentMessage.type).toBe('job:cancelAll');
			expect(sentMessage.queue).toBe(name);
		});
	});

	describe('getJobStatus', () => {
		it('should delegate to transport.getJobStatus', async () => {
			const name = uniqueQueueName();
			const queue = Queue.get(name, { transport: MockTransport });
			const transport = (queue as any).transport as MockTransport;

			const mockStatus = {
				jobId: 'job-1',
				dispatchId: 'dispatch-1',
				queue: name,
				status: 'completed',
				retries: 0,
				createdAt: new Date().toISOString()
			};
			transport.getJobStatus.mockResolvedValueOnce(mockStatus);

			const result = await queue.getJobStatus({
				jobId: 'job-1',
				dispatchId: 'dispatch-1'
			});

			expect(result).toEqual(mockStatus);
		});

		it('should return null when transport throws', async () => {
			const name = uniqueQueueName();
			const queue = Queue.get(name, { transport: MockTransport });
			const transport = (queue as any).transport as MockTransport;

			transport.getJobStatus.mockRejectedValueOnce(new Error('unavailable'));

			const result = await queue.getJobStatus({
				jobId: 'job-1',
				dispatchId: 'dispatch-1'
			});
			expect(result).toBeNull();
		});
	});

	describe('start / stop', () => {
		it('should call transport.start()', async () => {
			const name = uniqueQueueName();
			const queue = Queue.get(name, { transport: MockTransport });
			const transport = (queue as any).transport as MockTransport;

			await queue.start();
			expect(transport.start).toHaveBeenCalled();
		});

		it('should call transport.stop()', async () => {
			const name = uniqueQueueName();
			const queue = Queue.get(name, { transport: MockTransport });
			const transport = (queue as any).transport as MockTransport;

			await queue.stop();
			expect(transport.stop).toHaveBeenCalled();
		});

		it('should leave the transport running when start is called during a stop', async () => {
			const name = uniqueQueueName();
			const queue = Queue.get(name, { transport: MockTransport });
			const transport = (queue as any).transport as MockTransport;

			const events: string[] = [];
			transport.start.mockImplementation(async () => {
				events.push('start');
			});
			transport.stop.mockImplementation(async () => {
				await Bun.sleep(5);
				events.push('stop');
			});

			await queue.start();
			const stopping = queue.stop();
			const starting = queue.start();
			await Promise.all([stopping, starting]);

			expect(events).toEqual(['start', 'stop', 'start']);
		});

		it('should not start twice when a failed start settles behind a newer one', async () => {
			const name = uniqueQueueName();
			const queue = Queue.get(name, { transport: MockTransport });
			const transport = (queue as any).transport as MockTransport;

			transport.start.mockImplementationOnce(async () => {
				await Bun.sleep(5);
				throw new Error('start failed');
			});

			const failing = queue.start().catch(() => {});
			const stopping = queue.stop();
			const second = queue.start();
			await failing;
			const third = queue.start();
			await Promise.all([stopping, second, third]);

			expect(transport.start).toHaveBeenCalledTimes(2);
		});
	});

	describe('getOptions / updateOptions', () => {
		it('should return queue options', () => {
			const name = uniqueQueueName();
			const queue = Queue.get(name, {
				transport: MockTransport,
				concurrency: 4,
				maxRetries: 3
			});

			const options = queue.getOptions();
			expect(options.concurrency).toBe(4);
			expect(options.maxRetries).toBe(3);
		});

		it('should return a copy of options', () => {
			const name = uniqueQueueName();
			const queue = Queue.get(name, { transport: MockTransport });

			const options = queue.getOptions();
			options.concurrency = 999;

			expect(queue.getOptions().concurrency).not.toBe(999);
		});

		it('should merge new options', () => {
			const name = uniqueQueueName();
			const queue = Queue.get(name, { transport: MockTransport });

			queue.updateOptions({ concurrency: 8 });
			expect(queue.getOptions().concurrency).toBe(8);
		});
	});

	describe('getAllJobs', () => {
		it('should return an empty array initially', () => {
			const name = uniqueQueueName();
			const queue = Queue.get(name, { transport: MockTransport });

			expect(queue.getAllJobs()).toEqual([]);
		});
	});
});
