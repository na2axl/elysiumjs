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

import type { RedisClientFactory, RedisConnection } from '../index';

import { InteractsWithConsole } from '@elysiumjs/olympus';

import { bunRedis, Redis } from '../index';

/**
 * Histogram for tracking distributions
 */
class Histogram {
	private values: number[] = [];
	private sorted: boolean = false;

	/**
	 * Add a value to the histogram
	 */
	record(value: number): void {
		this.values.push(value);
		this.sorted = false;
	}

	/**
	 * Get percentile value
	 */
	percentile(p: number): number {
		if (this.values.length === 0) return 0;

		if (!this.sorted) {
			this.values.sort((a, b) => a - b);
			this.sorted = true;
		}

		const index = Math.ceil((p / 100) * this.values.length) - 1;
		return this.values[Math.max(0, Math.min(index, this.values.length - 1))];
	}

	/**
	 * Get average value
	 */
	average(): number {
		if (this.values.length === 0) return 0;
		return this.values.reduce((a, b) => a + b, 0) / this.values.length;
	}

	/**
	 * Get minimum value
	 */
	min(): number {
		if (this.values.length === 0) return 0;
		return Math.min(...this.values);
	}

	/**
	 * Get maximum value
	 */
	max(): number {
		if (this.values.length === 0) return 0;
		return Math.max(...this.values);
	}

	/**
	 * Clear the histogram
	 */
	clear(): void {
		this.values = [];
		this.sorted = false;
	}

	/**
	 * Get the count of values
	 */
	count(): number {
		return this.values.length;
	}
}

/**
 * Counter for tracking counts
 */
class Counter {
	private value: number = 0;
	private lastReset: number = Date.now();

	/**
	 * Increment the counter
	 */
	increment(delta: number = 1): void {
		this.value += delta;
	}

	/**
	 * Get the current value
	 */
	get(): number {
		return this.value;
	}

	/**
	 * Get the rate per second
	 */
	rate(): number {
		const elapsed = (Date.now() - this.lastReset) / 1000;
		return elapsed > 0 ? this.value / elapsed : 0;
	}

	/**
	 * Reset the counter
	 */
	reset(): void {
		this.value = 0;
		this.lastReset = Date.now();
	}
}

/**
 * Gauge for tracking current values
 */
class Gauge {
	private value: number = 0;

	/**
	 * Set the gauge value
	 */
	set(value: number): void {
		this.value = value;
	}

	/**
	 * Get the current value
	 */
	get(): number {
		return this.value;
	}

	/**
	 * Increment the gauge
	 */
	increment(delta: number = 1): void {
		this.value += delta;
	}

	/**
	 * Decrement the gauge
	 */
	decrement(delta: number = 1): void {
		this.value -= delta;
	}
}

/**
 * Performance monitoring system for Heracles
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class PerformanceMonitor extends InteractsWithConsole {
	private client?: RedisConnection;
	private metrics: Map<string, Histogram | Counter | Gauge> = new Map();
	private timers: Map<string, number> = new Map();
	private reportingInterval?: NodeJS.Timeout;
	private keyPrefix: string;

	/**
	 * Job processing metrics
	 */
	public readonly jobProcessingTime: Histogram;
	public readonly jobQueueTime: Histogram;
	public readonly jobRetryCount: Counter;
	public readonly jobSuccessCount: Counter;
	public readonly jobFailureCount: Counter;

	/**
	 * Queue metrics
	 */
	public readonly queueDepth: Gauge;
	public readonly queueThroughput: Counter;
	public readonly queueBacklog: Gauge;

	/**
	 * Redis metrics
	 */
	public readonly redisLatency: Histogram;
	public readonly redisCommands: Counter;
	public readonly redisErrors: Counter;

	/**
	 * Worker metrics
	 */
	public readonly workerUtilization: Gauge;
	public readonly workerConcurrency: Gauge;
	public readonly workerMemoryUsage: Gauge;

	constructor(
		options: {
			/**
			 * The `RedisModule` connection to report to. The monitor reports on a duplicate of it,
			 * created with the connection's own client.
			 */
			connection?: string;
			/** The Redis server to report to, when no `connection` is given. */
			redisUrl?: string;
			/** Creates the client of `redisUrl`. Defaults to `bunRedis`. */
			client?: RedisClientFactory;
			keyPrefix?: string;
			enableReporting?: boolean;
			reportingInterval?: number;
		} = {}
	) {
		super();

		this.keyPrefix = options.keyPrefix || 'heracles:metrics';

		// Initialize metrics
		this.jobProcessingTime = new Histogram();
		this.jobQueueTime = new Histogram();
		this.jobRetryCount = new Counter();
		this.jobSuccessCount = new Counter();
		this.jobFailureCount = new Counter();

		this.queueDepth = new Gauge();
		this.queueThroughput = new Counter();
		this.queueBacklog = new Gauge();

		this.redisLatency = new Histogram();
		this.redisCommands = new Counter();
		this.redisErrors = new Counter();

		this.workerUtilization = new Gauge();
		this.workerConcurrency = new Gauge();
		this.workerMemoryUsage = new Gauge();

		// Register all metrics
		this.metrics.set('job.processing.time', this.jobProcessingTime);
		this.metrics.set('job.queue.time', this.jobQueueTime);
		this.metrics.set('job.retry.count', this.jobRetryCount);
		this.metrics.set('job.success.count', this.jobSuccessCount);
		this.metrics.set('job.failure.count', this.jobFailureCount);
		this.metrics.set('queue.depth', this.queueDepth);
		this.metrics.set('queue.throughput', this.queueThroughput);
		this.metrics.set('queue.backlog', this.queueBacklog);
		this.metrics.set('redis.latency', this.redisLatency);
		this.metrics.set('redis.commands', this.redisCommands);
		this.metrics.set('redis.errors', this.redisErrors);
		this.metrics.set('worker.utilization', this.workerUtilization);
		this.metrics.set('worker.concurrency', this.workerConcurrency);
		this.metrics.set('worker.memory.usage', this.workerMemoryUsage);

		// Report to Redis when a connection or a URL is given
		if (options.enableReporting && (options.connection || options.redisUrl)) {
			const connect = options.connection
				? () => Redis.getConnection(options.connection!).duplicate()
				: async () =>
						(options.client ?? bunRedis)(options.redisUrl!, { enableAutoPipelining: true });
			this.initializeReporting(connect, options.reportingInterval || 10000);
		}
	}

	/**
	 * Initialize Redis reporting
	 */
	private async initializeReporting(
		connect: () => Promise<RedisConnection>,
		interval: number
	): Promise<void> {
		this.client = await connect();

		await this.client.connect();

		// Start reporting interval
		this.reportingInterval = setInterval(() => {
			this.reportMetrics();
		}, interval);

		this.info(`Performance monitoring initialized with ${interval}ms reporting interval`);
	}

	/**
	 * Start a timer
	 */
	startTimer(name: string): void {
		this.timers.set(name, Date.now());
	}

	/**
	 * End a timer and record the duration
	 */
	endTimer(name: string, metric?: Histogram): number {
		const start = this.timers.get(name);
		if (!start) {
			this.warning(`Timer '${name}' was not started`);
			return 0;
		}

		const duration = Date.now() - start;
		this.timers.delete(name);

		if (metric) {
			metric.record(duration);
		}

		return duration;
	}

	/**
	 * Record a job execution
	 */
	recordJobExecution(
		_jobId: string,
		_queue: string,
		duration: number,
		success: boolean,
		retries: number = 0
	): void {
		this.jobProcessingTime.record(duration);

		if (success) {
			this.jobSuccessCount.increment();
		} else {
			this.jobFailureCount.increment();
		}

		if (retries > 0) {
			this.jobRetryCount.increment(retries);
		}

		this.queueThroughput.increment();
	}

	/**
	 * Record Redis operation
	 */
	recordRedisOperation(_command: string, duration: number, error?: Error): void {
		this.redisLatency.record(duration);
		this.redisCommands.increment();

		if (error) {
			this.redisErrors.increment();
		}
	}

	/**
	 * Update worker metrics
	 */
	updateWorkerMetrics(utilization: number, concurrency: number): void {
		this.workerUtilization.set(utilization);
		this.workerConcurrency.set(concurrency);

		// Update memory usage
		const memUsage = globalThis.process?.memoryUsage?.() ?? { heapUsed: 0 }; // portability-allow: optional metric, zero where the host has no process
		this.workerMemoryUsage.set(memUsage.heapUsed / 1024 / 1024); // MB
	}

	/**
	 * Update queue metrics
	 */
	updateQueueMetrics(depth: number, backlog: number): void {
		this.queueDepth.set(depth);
		this.queueBacklog.set(backlog);
	}

	/**
	 * Get current metrics summary
	 */
	getSummary(): Record<string, any> {
		return {
			jobs: {
				processing: {
					p50: this.jobProcessingTime.percentile(50),
					p95: this.jobProcessingTime.percentile(95),
					p99: this.jobProcessingTime.percentile(99),
					avg: this.jobProcessingTime.average(),
					min: this.jobProcessingTime.min(),
					max: this.jobProcessingTime.max(),
					count: this.jobProcessingTime.count()
				},
				queueTime: {
					p50: this.jobQueueTime.percentile(50),
					p95: this.jobQueueTime.percentile(95),
					avg: this.jobQueueTime.average()
				},
				success: this.jobSuccessCount.get(),
				failure: this.jobFailureCount.get(),
				retries: this.jobRetryCount.get(),
				throughput: this.queueThroughput.rate()
			},
			queue: {
				depth: this.queueDepth.get(),
				backlog: this.queueBacklog.get()
			},
			redis: {
				latency: {
					p50: this.redisLatency.percentile(50),
					p95: this.redisLatency.percentile(95),
					p99: this.redisLatency.percentile(99),
					avg: this.redisLatency.average()
				},
				commands: this.redisCommands.get(),
				commandRate: this.redisCommands.rate(),
				errors: this.redisErrors.get()
			},
			worker: {
				utilization: this.workerUtilization.get(),
				concurrency: this.workerConcurrency.get(),
				memoryMB: this.workerMemoryUsage.get()
			}
		};
	}

	/**
	 * Report metrics to Redis
	 */
	private async reportMetrics(): Promise<void> {
		if (!this.client?.connected) return;

		try {
			const summary = this.getSummary();
			const timestamp = Date.now();

			// Store summary in Redis
			const key = `${this.keyPrefix}:summary:${timestamp}`;
			await this.client.set(key, JSON.stringify(summary));
			await this.client.expire(key, 3600); // Keep for 1 hour

			// Store time-series data for key metrics
			const promises: Promise<any>[] = [];

			// Job throughput time series
			promises.push(
				this.client.send('ZADD', [
					`${this.keyPrefix}:ts:throughput`,
					timestamp.toString(),
					summary.jobs.throughput.toString()
				])
			);

			// Job success/failure rates
			promises.push(
				this.client.send('ZADD', [
					`${this.keyPrefix}:ts:success`,
					timestamp.toString(),
					summary.jobs.success.toString()
				])
			);

			// Queue depth
			promises.push(
				this.client.send('ZADD', [
					`${this.keyPrefix}:ts:queue_depth`,
					timestamp.toString(),
					summary.queue.depth.toString()
				])
			);

			// Worker utilization
			promises.push(
				this.client.send('ZADD', [
					`${this.keyPrefix}:ts:utilization`,
					timestamp.toString(),
					summary.worker.utilization.toString()
				])
			);

			await Promise.all(promises);

			// Trim old data (keep last 24 hours)
			const cutoff = timestamp - 86400000;
			await Promise.all([
				this.client.send('ZREMRANGEBYSCORE', [
					`${this.keyPrefix}:ts:throughput`,
					'-inf',
					cutoff.toString()
				]),
				this.client.send('ZREMRANGEBYSCORE', [
					`${this.keyPrefix}:ts:success`,
					'-inf',
					cutoff.toString()
				]),
				this.client.send('ZREMRANGEBYSCORE', [
					`${this.keyPrefix}:ts:queue_depth`,
					'-inf',
					cutoff.toString()
				]),
				this.client.send('ZREMRANGEBYSCORE', [
					`${this.keyPrefix}:ts:utilization`,
					'-inf',
					cutoff.toString()
				])
			]);
		} catch (error) {
			this.error(`Failed to report metrics: ${error}`);
		}
	}

	/**
	 * Get historical metrics
	 */
	async getHistoricalMetrics(
		metric: string,
		start: number,
		end: number = Date.now()
	): Promise<Array<{ timestamp: number; value: number }>> {
		if (!this.client?.connected) return [];

		try {
			const key = `${this.keyPrefix}:ts:${metric}`;
			const data = (await this.client.send('ZRANGEBYSCORE', [
				key,
				start.toString(),
				end.toString(),
				'WITHSCORES'
			])) as string[];

			const results: Array<{ timestamp: number; value: number }> = [];

			for (let i = 0; i < data.length; i += 2) {
				results.push({
					value: parseFloat(data[i]),
					timestamp: parseInt(data[i + 1], 10)
				});
			}

			return results;
		} catch (error) {
			this.error(`Failed to get historical metrics: ${error}`);
			return [];
		}
	}

	/**
	 * Clean up and stop reporting
	 */
	async shutdown(): Promise<void> {
		if (this.reportingInterval) {
			clearInterval(this.reportingInterval);
			this.reportingInterval = undefined;
		}

		// Final report
		await this.reportMetrics();

		if (this.client) {
			this.client.close();
			this.client = undefined;
		}

		this.info('Performance monitor shut down');
	}
}
