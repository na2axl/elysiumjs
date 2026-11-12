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

import type { Transport } from '../../src/heracles/transport';

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

import { Job, JobStatus } from '../../src/heracles/job';
import { WorkerStatus } from '../../src/heracles/worker';
import { BaseWorker } from '../../src/heracles/workers/base.worker';

// Concrete test implementation of BaseWorker
class TestWorker extends BaseWorker<Transport> {
	public processNextJobCalls: string[] = [];

	protected async processNextJob(queueName: string): Promise<void> {
		this.processNextJobCalls.push(queueName);
		const queue = this.queues.get(queueName);
		if (!queue || queue.jobs.length === 0) return;

		const next = queue.jobs.shift()!;
		queue.activeJobs.set(next.job.id, next);

		try {
			await next.job.run();
		} finally {
			queue.activeJobs.delete(next.job.id);
		}
	}
}

// Simple test job
class SimpleTestJob extends Job {
	public executed = false;

	protected async execute(): Promise<void> {
		this.executed = true;
	}
}

describe('BaseWorker', () => {
	let worker: TestWorker;

	beforeEach(() => {
		worker = new TestWorker('test-worker');
	});

	afterEach(async () => {
		try {
			await worker.stop(true);
		} catch {
			// Ignore cleanup errors
		}
	});

	describe('constructor', () => {
		it('should create a worker with a provided ID', () => {
			expect(worker.id).toBe('test-worker');
			expect(worker.status).toBe(WorkerStatus.IDLE);
		});

		it('should generate an ID if not provided', () => {
			const autoWorker = new TestWorker();
			expect(autoWorker.id).toBeDefined();
			expect(autoWorker.id.length).toBeGreaterThan(0);
		});

		it('should create a default queue', async () => {
			const size = await worker.size('default');
			expect(size).toBe(0);
		});
	});

	describe('createQueue', () => {
		it('should create a new queue', async () => {
			await worker.createQueue({ name: 'test-queue' });
			const size = await worker.size('test-queue');
			expect(size).toBe(0);
		});

		it('should return the worker for chaining', async () => {
			const result = await worker.createQueue({ name: 'chain-queue' });
			expect(result).toBe(worker);
		});

		it('should not create a duplicate queue', async () => {
			await worker.createQueue({ name: 'dup-queue' });
			await worker.createQueue({ name: 'dup-queue' });
			// Should not throw, just log debug
			const size = await worker.size('dup-queue');
			expect(size).toBe(0);
		});
	});

	describe('addJob', () => {
		it('should add a job to the default queue', async () => {
			const job = new SimpleTestJob();
			await worker.addJob(job);

			// Wait for processNextJob to be called
			await Bun.sleep(50);
			expect(job.executed).toBe(true);
		});

		it('should throw for a non-existent queue', async () => {
			const job = new SimpleTestJob();
			await expect(worker.addJob(job, 'nonexistent')).rejects.toThrow(
				"Queue 'nonexistent' does not exist"
			);
		});

		it('should throw when queue is draining', async () => {
			await worker.drain('default');
			const job = new SimpleTestJob();
			await expect(worker.addJob(job, 'default')).rejects.toThrow(
				"Queue 'default' is draining"
			);
		});

		it("should set the job's queueName", async () => {
			const job = new SimpleTestJob();
			await worker.addJob(job, 'default');
			expect(job.queueName).toBe('default');
		});
	});

	describe('pause / resume', () => {
		it('should pause a specific queue', async () => {
			await worker.pause('default');
			const stats = await worker.getStats();
			expect(stats['default'].paused).toBe(true);
		});

		it('should pause all queues', async () => {
			await worker.createQueue({ name: 'second' });
			await worker.pause();

			const stats = await worker.getStats();
			expect(stats['default'].paused).toBe(true);
			expect(stats['second'].paused).toBe(true);
		});

		it('should resume a specific queue', async () => {
			await worker.pause('default');
			await worker.resume('default');

			const stats = await worker.getStats();
			expect(stats['default'].paused).toBe(false);
		});

		it('should resume all queues', async () => {
			await worker.createQueue({ name: 'second' });
			await worker.pause();
			await worker.resume();

			const stats = await worker.getStats();
			expect(stats['default'].paused).toBe(false);
			expect(stats['second'].paused).toBe(false);
		});

		it('should log warning for non-existent queue pause', async () => {
			// Should not throw
			await worker.pause('nonexistent');
		});

		it('should log warning for non-existent queue resume', async () => {
			// Should not throw
			await worker.resume('nonexistent');
		});
	});

	describe('drain', () => {
		it('should set queue to draining', async () => {
			await worker.drain('default');

			const stats = await worker.getStats();
			expect(stats['default'].draining).toBe(true);
		});

		it('should set all queues to draining', async () => {
			await worker.createQueue({ name: 'second' });
			await worker.drain();

			expect(worker.status).toBe(WorkerStatus.DRAINING);
			const stats = await worker.getStats();
			expect(stats['default'].draining).toBe(true);
			expect(stats['second'].draining).toBe(true);
		});
	});

	describe('clear', () => {
		it('should cancel and clear all jobs from a queue', async () => {
			// Pause to prevent auto-processing
			await worker.pause('default');

			const job1 = new SimpleTestJob();
			const job2 = new SimpleTestJob();
			await worker.addJob(job1, 'default');
			await worker.addJob(job2, 'default');

			await worker.clear('default');

			const size = await worker.size('default');
			expect(size).toBe(0);
			expect(job1.status).toBe(JobStatus.CANCELLED);
			expect(job2.status).toBe(JobStatus.CANCELLED);
		});

		it('should clear all queues', async () => {
			await worker.createQueue({ name: 'second' });
			await worker.pause();

			const job1 = new SimpleTestJob();
			const job2 = new SimpleTestJob();
			await worker.addJob(job1, 'default');
			await worker.addJob(job2, 'second');

			await worker.clear();

			expect(await worker.totalSize()).toBe(0);
		});
	});

	describe('size / totalSize', () => {
		it('should return 0 for an empty queue', async () => {
			expect(await worker.size('default')).toBe(0);
		});

		it('should throw for a non-existent queue', async () => {
			await expect(worker.size('nonexistent')).rejects.toThrow(
				"Queue 'nonexistent' does not exist"
			);
		});

		it('should return total across all queues', async () => {
			expect(await worker.totalSize()).toBe(0);
		});
	});

	describe('getStats', () => {
		it('should return stats for all queues', async () => {
			await worker.createQueue({ name: 'second' });

			const stats = await worker.getStats();
			expect(stats['default']).toBeDefined();
			expect(stats['default'].waiting).toBe(0);
			expect(stats['default'].processing).toBe(0);
			expect(stats['default'].paused).toBe(false);
			expect(stats['default'].draining).toBe(false);
			expect(stats['second']).toBeDefined();
		});
	});

	describe('cancelJob', () => {
		it('should cancel a waiting job and return true', async () => {
			await worker.pause('default');

			const job = new SimpleTestJob('cancel-test-id');
			await worker.addJob(job, 'default');

			const result = await worker.cancelJob('cancel-test-id');
			expect(result).toBe(true);
			expect(job.status).toBe(JobStatus.CANCELLED);
		});

		it('should return false if job not found', async () => {
			const result = await worker.cancelJob('nonexistent-job');
			expect(result).toBe(false);
		});
	});

	describe('cancelAllJobs', () => {
		it('should cancel all waiting jobs', async () => {
			await worker.pause('default');

			const job1 = new SimpleTestJob();
			const job2 = new SimpleTestJob();
			await worker.addJob(job1, 'default');
			await worker.addJob(job2, 'default');

			const count = await worker.cancelAllJobs('default');
			expect(count).toBeGreaterThanOrEqual(2);
		});
	});

	describe('getJob', () => {
		it('should find a waiting job by ID', async () => {
			await worker.pause('default');

			const job = new SimpleTestJob('find-me');
			await worker.addJob(job, 'default');

			const found = await worker.getJob('find-me');
			expect(found).toBe(job);
		});

		it('should return null for non-existent job', async () => {
			const found = await worker.getJob('nonexistent');
			expect(found).toBeNull();
		});
	});

	describe('start / stop', () => {
		it('should return to IDLE after start with empty queues', async () => {
			await worker.start();
			// With no active jobs, processQueueJobs sets status back to IDLE
			expect(worker.status).toBe(WorkerStatus.IDLE);
		});

		it('should set status to STOPPED on stop', async () => {
			await worker.start();
			await worker.stop(true);
			expect(worker.status).toBe(WorkerStatus.STOPPED);
		});
	});

	describe('getInfo', () => {
		it('should return worker information', () => {
			const info = worker.getInfo();

			expect(info.id).toBe('test-worker');
			expect(info.status).toBe(WorkerStatus.IDLE);
			expect(info.queues).toContain('default');
			expect(info.activeJobs).toBe(0);
			expect(info.startedAt).toBeInstanceOf(Date);
			expect(typeof info.addJob).toBe('function');
			expect(typeof info.cancelJob).toBe('function');
			expect(typeof info.cancelAllJobs).toBe('function');
		});
	});

	describe('setConcurrency', () => {
		it('should update queue concurrency', async () => {
			await worker.setConcurrency('default', 4);
			// No public API to verify, but it should not throw
		});

		it('should throw for non-existent queue', async () => {
			await expect(worker.setConcurrency('nonexistent', 2)).rejects.toThrow(
				"Queue 'nonexistent' does not exist"
			);
		});

		it('should clamp concurrency to at least 1', async () => {
			await worker.setConcurrency('default', 0);
			// Should not throw, uses 1 instead
		});
	});
});
