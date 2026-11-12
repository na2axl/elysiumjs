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

import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';

import { PerformanceMonitor } from '../../src/heracles/performance-monitor';

describe('PerformanceMonitor', () => {
	let monitor: PerformanceMonitor;

	beforeEach(() => {
		monitor = new PerformanceMonitor();
	});

	describe('constructor', () => {
		it('should initialize all metric instances', () => {
			expect(monitor.jobProcessingTime).toBeDefined();
			expect(monitor.jobQueueTime).toBeDefined();
			expect(monitor.jobRetryCount).toBeDefined();
			expect(monitor.jobSuccessCount).toBeDefined();
			expect(monitor.jobFailureCount).toBeDefined();
			expect(monitor.queueDepth).toBeDefined();
			expect(monitor.queueThroughput).toBeDefined();
			expect(monitor.queueBacklog).toBeDefined();
			expect(monitor.redisLatency).toBeDefined();
			expect(monitor.redisCommands).toBeDefined();
			expect(monitor.redisErrors).toBeDefined();
			expect(monitor.workerUtilization).toBeDefined();
			expect(monitor.workerConcurrency).toBeDefined();
			expect(monitor.workerMemoryUsage).toBeDefined();
		});
	});

	describe('startTimer / endTimer', () => {
		it('should record elapsed duration', async () => {
			monitor.startTimer('test-timer');
			await Bun.sleep(50);
			const duration = monitor.endTimer('test-timer');

			expect(duration).toBeGreaterThanOrEqual(40);
			expect(duration).toBeLessThan(200);
		});

		it('should record to a metric if provided', () => {
			monitor.startTimer('metric-timer');
			const duration = monitor.endTimer('metric-timer', monitor.jobProcessingTime);

			expect(duration).toBeGreaterThanOrEqual(0);
			expect(monitor.jobProcessingTime.count()).toBe(1);
		});

		it('should return 0 for an unstarted timer', () => {
			const duration = monitor.endTimer('unknown-timer');
			expect(duration).toBe(0);
		});
	});

	describe('recordJobExecution', () => {
		it('should record successful job execution', () => {
			monitor.recordJobExecution('job-1', 'default', 100, true);

			expect(monitor.jobProcessingTime.count()).toBe(1);
			expect(monitor.jobSuccessCount.get()).toBe(1);
			expect(monitor.jobFailureCount.get()).toBe(0);
			expect(monitor.queueThroughput.get()).toBe(1);
		});

		it('should record failed job execution', () => {
			monitor.recordJobExecution('job-1', 'default', 50, false);

			expect(monitor.jobProcessingTime.count()).toBe(1);
			expect(monitor.jobSuccessCount.get()).toBe(0);
			expect(monitor.jobFailureCount.get()).toBe(1);
			expect(monitor.queueThroughput.get()).toBe(1);
		});

		it('should record retry count when retries > 0', () => {
			monitor.recordJobExecution('job-1', 'default', 100, true, 3);

			expect(monitor.jobRetryCount.get()).toBe(3);
		});

		it('should not record retries when retries is 0', () => {
			monitor.recordJobExecution('job-1', 'default', 100, true, 0);

			expect(monitor.jobRetryCount.get()).toBe(0);
		});
	});

	describe('recordRedisOperation', () => {
		it('should record latency and increment commands', () => {
			monitor.recordRedisOperation('GET', 5);

			expect(monitor.redisLatency.count()).toBe(1);
			expect(monitor.redisCommands.get()).toBe(1);
			expect(monitor.redisErrors.get()).toBe(0);
		});

		it('should increment errors when error is provided', () => {
			monitor.recordRedisOperation('SET', 10, new Error('timeout'));

			expect(monitor.redisLatency.count()).toBe(1);
			expect(monitor.redisCommands.get()).toBe(1);
			expect(monitor.redisErrors.get()).toBe(1);
		});
	});

	describe('updateWorkerMetrics', () => {
		it('should set utilization and concurrency', () => {
			monitor.updateWorkerMetrics(0.75, 4);

			expect(monitor.workerUtilization.get()).toBe(0.75);
			expect(monitor.workerConcurrency.get()).toBe(4);
		});

		it('should update memory usage', () => {
			monitor.updateWorkerMetrics(0.5, 2);

			expect(monitor.workerMemoryUsage.get()).toBeGreaterThan(0);
		});
	});

	describe('updateQueueMetrics', () => {
		it('should set depth and backlog', () => {
			monitor.updateQueueMetrics(10, 5);

			expect(monitor.queueDepth.get()).toBe(10);
			expect(monitor.queueBacklog.get()).toBe(5);
		});
	});

	describe('getSummary', () => {
		it('should return a complete summary object', () => {
			monitor.recordJobExecution('j1', 'default', 100, true);
			monitor.recordJobExecution('j2', 'default', 200, false);
			monitor.updateWorkerMetrics(0.5, 2);
			monitor.updateQueueMetrics(3, 1);

			const summary = monitor.getSummary();

			expect(summary.jobs).toBeDefined();
			expect(summary.jobs.processing).toBeDefined();
			expect(summary.jobs.processing.p50).toBeDefined();
			expect(summary.jobs.processing.p95).toBeDefined();
			expect(summary.jobs.processing.p99).toBeDefined();
			expect(summary.jobs.processing.avg).toBeDefined();
			expect(summary.jobs.processing.min).toBeDefined();
			expect(summary.jobs.processing.max).toBeDefined();
			expect(summary.jobs.processing.count).toBe(2);
			expect(summary.jobs.success).toBe(1);
			expect(summary.jobs.failure).toBe(1);
			expect(summary.queue.depth).toBe(3);
			expect(summary.queue.backlog).toBe(1);
			expect(summary.worker.utilization).toBe(0.5);
			expect(summary.worker.concurrency).toBe(2);
			expect(summary.redis).toBeDefined();
		});

		it('should return zeroes when no data recorded', () => {
			const summary = monitor.getSummary();

			expect(summary.jobs.processing.count).toBe(0);
			expect(summary.jobs.processing.avg).toBe(0);
			expect(summary.jobs.success).toBe(0);
			expect(summary.jobs.failure).toBe(0);
		});
	});

	describe('Histogram (via jobProcessingTime)', () => {
		it('should compute correct percentile', () => {
			const h = monitor.jobProcessingTime;
			for (let i = 1; i <= 100; i++) {
				h.record(i);
			}

			expect(h.percentile(50)).toBe(50);
			expect(h.percentile(95)).toBe(95);
			expect(h.percentile(99)).toBe(99);
			expect(h.percentile(100)).toBe(100);
		});

		it('should compute correct average', () => {
			const h = monitor.jobProcessingTime;
			h.record(10);
			h.record(20);
			h.record(30);

			expect(h.average()).toBe(20);
		});

		it('should compute correct min and max', () => {
			const h = monitor.jobProcessingTime;
			h.record(5);
			h.record(15);
			h.record(10);

			expect(h.min()).toBe(5);
			expect(h.max()).toBe(15);
		});

		it('should return 0 for empty histogram', () => {
			const h = monitor.jobProcessingTime;

			expect(h.percentile(50)).toBe(0);
			expect(h.average()).toBe(0);
			expect(h.min()).toBe(0);
			expect(h.max()).toBe(0);
			expect(h.count()).toBe(0);
		});

		it('should clear values', () => {
			const h = monitor.jobProcessingTime;
			h.record(10);
			h.record(20);
			expect(h.count()).toBe(2);

			h.clear();
			expect(h.count()).toBe(0);
			expect(h.average()).toBe(0);
		});
	});

	describe('Counter (via jobSuccessCount)', () => {
		it('should increment by default delta of 1', () => {
			const c = monitor.jobSuccessCount;
			c.increment();
			expect(c.get()).toBe(1);

			c.increment();
			expect(c.get()).toBe(2);
		});

		it('should increment by custom delta', () => {
			const c = monitor.jobSuccessCount;
			c.increment(5);
			expect(c.get()).toBe(5);
		});

		it('should reset to 0', () => {
			const c = monitor.jobSuccessCount;
			c.increment(10);
			c.reset();
			expect(c.get()).toBe(0);
		});

		it('should compute rate per second', async () => {
			const c = monitor.jobSuccessCount;
			c.reset();
			c.increment(10);
			await Bun.sleep(100);

			const rate = c.rate();
			expect(rate).toBeGreaterThan(0);
		});
	});

	describe('Gauge (via queueDepth)', () => {
		it('should set and get value', () => {
			const g = monitor.queueDepth;
			g.set(42);
			expect(g.get()).toBe(42);
		});

		it('should increment', () => {
			const g = monitor.queueDepth;
			g.set(10);
			g.increment();
			expect(g.get()).toBe(11);

			g.increment(5);
			expect(g.get()).toBe(16);
		});

		it('should decrement', () => {
			const g = monitor.queueDepth;
			g.set(10);
			g.decrement();
			expect(g.get()).toBe(9);

			g.decrement(3);
			expect(g.get()).toBe(6);
		});
	});
});

describe('PerformanceMonitor reporting', () => {
	it('reports through the given client factory instead of a Bun client', async () => {
		const sent: string[] = [];
		const connection = {
			connected: true,
			connect: mock(async () => {}),
			close: mock(() => {}),
			set: mock(async (key: string) => void sent.push(`SET ${key}`)),
			expire: mock(async () => 1),
			send: mock(async (command: string) => void sent.push(command))
		};
		const factory = mock(() => connection as never);

		const monitor = new PerformanceMonitor({
			redisUrl: 'redis://metrics:6379',
			client: factory,
			enableReporting: true,
			reportingInterval: 60_000,
			keyPrefix: 'test:metrics'
		});
		await new Promise((resolve) => setTimeout(resolve, 0));
		await monitor.shutdown();

		expect(factory).toHaveBeenCalledWith('redis://metrics:6379', { enableAutoPipelining: true });
		expect(connection.connect).toHaveBeenCalled();
		expect(sent.some((entry) => entry.startsWith('SET test:metrics:summary:'))).toBe(true);
		expect(connection.close).toHaveBeenCalled();
	});
});
