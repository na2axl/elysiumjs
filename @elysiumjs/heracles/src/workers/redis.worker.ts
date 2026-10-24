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

import type { ModuleNode } from '@elysiumjs/core';
import type { JobClass } from '../job';
import type { JobDispatchOptions } from '../queue';
import type { TransportEvent } from '../transport';
import type { QueuedJob, QueueState, Worker, WorkerQueueOptions } from '../worker';

import { ModuleContext, Redis } from '@elysiumjs/core';
import { RedisClient } from 'bun';

import { Job, JobOverlapBehavior, JobStatus, WithId } from '../job';
import { TransportMode } from '../transport';
import { RedisTransport } from '../transports/redis.transport';
import { JobRegistry } from '../registry';
import { getJobMetadata } from '../utils';
import { BaseWorker } from './base.worker';

/** The module that owns each job instance, so it runs in that module's context. */
const jobOwners = new WeakMap<Job, ModuleNode>();

/**
 * Job batch for processing
 * @author Axel Nana <axel.nana@workbud.com>
 */
interface JobBatch {
	queue: string;
	jobs: QueuedJob[];
	timestamp: number;
}

/**
 * Worker metrics
 * @author Axel Nana <axel.nana@workbud.com>
 */
interface WorkerMetrics {
	jobsProcessed: number;
	jobsFailed: number;
	jobsRetried: number;
	averageProcessingTime: number;
	lastProcessedAt?: Date;
}

/**
 * Worker implementation that uses Redis for communication.
 * This worker can run in a separate process from the dispatcher.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class RedisWorker extends BaseWorker<RedisTransport> {
	/**
	 * Whether the worker is currently running
	 */
	private isRunning: boolean = false;

	/**
	 * Queues registered with this worker
	 */
	private registeredQueues: Set<string> = new Set();

	/**
	 * Job batches pending processing
	 */
	private pendingBatches: Map<string, JobBatch> = new Map();

	/**
	 * Batch processing timer
	 */
	private batchTimer?: ReturnType<typeof setInterval>;

	/**
	 * Worker metrics
	 */
	private metrics: WorkerMetrics = {
		jobsProcessed: 0,
		jobsFailed: 0,
		jobsRetried: 0,
		averageProcessingTime: 0
	};

	/**
	 * Metrics reporting client
	 */
	private metricsClient?: RedisClient;

	/**
	 * Metrics reporting timer
	 */
	private metricsTimer?: ReturnType<typeof setInterval>;

	/**
	 * Maximum batch size for processing
	 */
	private readonly maxBatchSize: number;

	/**
	 * Batch collection interval in milliseconds
	 */
	private readonly batchInterval: number;

	/**
	 * Creates a new RedisWorker instance
	 * @param connectionName Name of the Redis connection to use
	 * @param options Additional options
	 */
	constructor(
		connectionName: string = 'default',
		options: {
			id?: string;
			maxBatchSize?: number;
			batchInterval?: number;
			enableMetrics?: boolean;
			[key: string]: any;
		} = {}
	) {
		super(options.id);

		this.maxBatchSize = options.maxBatchSize || 10;
		this.batchInterval = options.batchInterval || 100;

		// Initialize transport
		this.transport = new RedisTransport(TransportMode.CONSUMER, {
			connection: connectionName,
			consumerName: `worker-${this.id}`,
			batchSize: this.maxBatchSize,
			...options
		});

		// Set up message handling
		this.transport.onMessage(this.handleTransportMessage.bind(this));

		// Initialize metrics client if enabled
		if (options.enableMetrics) {
			this.initializeMetrics(connectionName);
		}

		this.debug(`RedisWorker ${this.id} created with batch size: ${this.maxBatchSize}`);
	}

	/**
	 * Initialize metrics reporting
	 */
	private async initializeMetrics(connectionName: string): Promise<void> {
		this.metricsClient = await Redis.getConnection(connectionName).duplicate();
	}

	/**
	 * Report worker metrics
	 */
	private async reportMetrics(): Promise<void> {
		if (!this.metricsClient || !this.metricsClient.connected) {
			return;
		}

		const metricsKey = `worker:${this.id}:metrics`;

		try {
			await this.metricsClient.hmset(metricsKey, [
				'jobsProcessed',
				this.metrics.jobsProcessed.toString(),
				'jobsFailed',
				this.metrics.jobsFailed.toString(),
				'jobsRetried',
				this.metrics.jobsRetried.toString(),
				'averageProcessingTime',
				this.metrics.averageProcessingTime.toString(),
				'lastProcessedAt',
				(this.metrics.lastProcessedAt || new Date()).toISOString(),
				'timestamp',
				Date.now().toString()
			]);

			// Expire after 1 hour
			await this.metricsClient.expire(metricsKey, 3600);
		} catch (error) {
			this.error(`Failed to report metrics: ${error}`);
		}
	}

	/**
	 * Start the worker
	 */
	public async start(): Promise<void> {
		if (this.isRunning) {
			return;
		}

		// Call parent implementation
		await super.start();

		this.isRunning = true;

		// Store registered queues
		for (const queueName of this.queues.keys()) {
			this.registeredQueues.add(queueName);
		}

		// Start the transport
		await this.transport.start();

		// Connect metrics client
		if (this.metricsClient) {
			// Report metrics every 10 seconds
			this.metricsTimer = setInterval(() => {
				this.reportMetrics();
			}, 10000);

			await this.metricsClient.connect();
		}

		// Register worker
		await this.transport.registerWorker(this.id, Array.from(this.registeredQueues));

		// Start batch processing timer
		this.startBatchProcessing();

		this.info(
			`Redis worker ${this.id} started for queues: ${Array.from(this.registeredQueues).join(', ')}`
		);
	}

	/**
	 * Stop the worker
	 * @param force If true, cancel all jobs in progress
	 */
	public async stop(force: boolean = false): Promise<void> {
		this.isRunning = false;

		// Stop batch processing
		this.stopBatchProcessing();

		// Process remaining batches unless forced
		if (!force) {
			await this.processAllPendingBatches();
		}

		// Call parent implementation
		await super.stop(force);

		// Unregister worker
		await this.transport.unregisterWorker(this.id);

		// Stop the transport
		await this.transport.stop();

		// Close metrics client
		if (this.metricsClient) {
			this.metricsClient.close();

			clearInterval(this.metricsTimer);
			this.metricsClient = undefined;
		}

		this.info(`Redis worker ${this.id} stopped`);
	}

	/**
	 * Start batch processing timer
	 */
	private startBatchProcessing(): void {
		this.batchTimer = setInterval(() => {
			this.processBatches();
		}, this.batchInterval);
	}

	/**
	 * Stop batch processing timer
	 */
	private stopBatchProcessing(): void {
		if (this.batchTimer) {
			clearInterval(this.batchTimer);
			this.batchTimer = undefined;
		}
	}

	/**
	 * Process all pending batches
	 */
	private async processAllPendingBatches(): Promise<void> {
		for (const [_, batch] of this.pendingBatches) {
			if (batch.jobs.length > 0) {
				await this.processBatch(batch);
			}
		}

		this.pendingBatches.clear();
	}

	/**
	 * Process batches that are ready
	 */
	private async processBatches(): Promise<void> {
		const now = Date.now();

		for (const [queueName, batch] of this.pendingBatches) {
			const queue = this.queues.get(queueName);
			if (!queue) continue;

			// Process if batch is full or enough time has passed
			const shouldProcess =
				batch.jobs.length >= this.maxBatchSize ||
				(batch.jobs.length > 0 && now - batch.timestamp > this.batchInterval);

			if (shouldProcess) {
				// Remove from pending and process
				this.pendingBatches.delete(queueName);
				await this.processBatch(batch);
			}
		}
	}

	/**
	 * Process a batch of jobs
	 */
	private async processBatch(batch: JobBatch): Promise<void> {
		const queue = this.queues.get(batch.queue);
		if (!queue || queue.paused) return;

		const startTime = Date.now();

		// Group jobs by overlap behavior
		const overlapGroups = new Map<string, QueuedJob[]>();
		const regularJobs: QueuedJob[] = [];

		for (const job of batch.jobs) {
			const metadata = getJobMetadata(job.job.constructor as JobClass<Job>);

			if (metadata?.overlapBehavior === JobOverlapBehavior.NO_OVERLAP) {
				const key = job.job.id;
				if (!overlapGroups.has(key)) {
					overlapGroups.set(key, []);
				}
				overlapGroups.get(key)!.push(job);
			} else {
				regularJobs.push(job);
			}
		}

		// Process regular jobs in parallel
		const regularPromises = regularJobs.map((job) => this.processJobInternal(job, batch.queue));

		// Process NO_OVERLAP jobs sequentially by ID
		const overlapPromises: Promise<void>[] = [];
		for (const [_, jobs] of overlapGroups) {
			overlapPromises.push(this.processOverlapJobs(jobs, batch.queue));
		}

		// Wait for all jobs to complete
		await Promise.all([...regularPromises, ...overlapPromises]);

		// Update metrics
		const processingTime = Date.now() - startTime;
		this.updateMetrics(batch.jobs.length, processingTime);

		this.debug(
			`Processed batch of ${batch.jobs.length} jobs from queue '${batch.queue}' in ${processingTime}ms`
		);
	}

	/**
	 * Process NO_OVERLAP jobs sequentially
	 */
	private async processOverlapJobs(jobs: QueuedJob[], queueName: string): Promise<void> {
		for (const job of jobs) {
			const acquired = await this.transport.acquireJobLock(job.job.id, queueName);

			if (acquired) {
				try {
					await this.processJobInternal(job, queueName);
				} finally {
					const metadata = getJobMetadata(job.job.constructor as JobClass<Job>);

					// Release lock after delay if configured
					if (metadata?.overlapDelay && metadata.overlapDelay > 0) {
						setTimeout(() => {
							this.transport.releaseJobLock(job.job.id, queueName);
						}, metadata.overlapDelay);
					} else {
						await this.transport.releaseJobLock(job.job.id, queueName);
					}
				}
			} else {
				// Re-queue the job
				const queue = this.queues.get(queueName);
				if (queue) {
					queue.jobs.push(job);
				}
			}
		}
	}

	/**
	 * Process a single job internally
	 */
	private async processJobInternal(queuedJob: QueuedJob, queueName: string): Promise<void> {
		const queue = this.queues.get(queueName);
		if (!queue) return;

		// Track as active
		queue.activeJobs.set(queuedJob.job.id, queuedJob);

		// Update status to running
		await this.sendJobStatusUpdate(
			queuedJob.job.id,
			queuedJob.job.dispatchId,
			queueName,
			JobStatus.RUNNING
		);

		try {
			const owner = jobOwners.get(queuedJob.job);
			await (owner
				? ModuleContext.run(owner, () => queuedJob.job.run())
				: queuedJob.job.run());

			// Handle job result
			if (queuedJob.job.status === JobStatus.COMPLETED) {
				this.metrics.jobsProcessed++;
				await this.sendJobStatusUpdate(
					queuedJob.job.id,
					queuedJob.job.dispatchId,
					queueName,
					JobStatus.COMPLETED
				);
			} else if (queuedJob.job.status === JobStatus.FAILED) {
				await this.handleJobFailure(queuedJob, queue, queueName);
			} else if (queuedJob.job.status === JobStatus.CANCELLED) {
				await this.sendJobStatusUpdate(
					queuedJob.job.id,
					queuedJob.job.dispatchId,
					queueName,
					JobStatus.CANCELLED
				);
			}
		} catch (error) {
			this.error(`Error processing job ${queuedJob.job.id}: ${error}`);
			queuedJob.job.fail(error instanceof Error ? error : new Error(String(error)));
			await this.handleJobFailure(queuedJob, queue, queueName);
		} finally {
			// Remove from active jobs
			queue.activeJobs.delete(queuedJob.job.id);
			this.metrics.lastProcessedAt = new Date();
		}
	}

	/**
	 * Handle job failure with retry logic
	 */
	private async handleJobFailure(
		queuedJob: QueuedJob,
		queue: QueueState,
		queueName: string
	): Promise<void> {
		const maxRetries =
			queuedJob.maxRetries !== undefined ? queuedJob.maxRetries : queue.options.maxRetries!;

		if (queuedJob.retries < maxRetries) {
			// Retry the job
			queuedJob.retries++;
			queuedJob.job.incrementRetries();
			this.metrics.jobsRetried++;

			const retryDelay =
				queuedJob.retryDelay !== undefined ? queuedJob.retryDelay : queue.options.retryDelay!;

			await this.sendJobStatusUpdate(
				queuedJob.job.id,
				queuedJob.job.dispatchId,
				queueName,
				JobStatus.SCHEDULED_FOR_RETRY,
				queuedJob.job.lastError?.message
			);

			queue.retryingJobs.set(queuedJob.job.id, queuedJob);

			// Schedule retry
			setTimeout(() => {
				if (queuedJob.job.status !== JobStatus.CANCELLED) {
					this.addJobToBatch(queuedJob, queueName);
				}

				queue.retryingJobs.delete(queuedJob.job.id);
			}, retryDelay);
		} else {
			// Job failed after all retries
			this.metrics.jobsFailed++;
			await this.sendJobStatusUpdate(
				queuedJob.job.id,
				queuedJob.job.dispatchId,
				queueName,
				JobStatus.FAILED,
				queuedJob.job.lastError?.message
			);

			// Pause queue if configured
			if (queue.options.pauseOnError) {
				await this.pause(queueName);
			}
		}
	}

	/**
	 * Add a job to the batch for processing
	 */
	private addJobToBatch(queuedJob: QueuedJob, queueName: string): void {
		if (!this.pendingBatches.has(queueName)) {
			this.pendingBatches.set(queueName, {
				queue: queueName,
				jobs: [],
				timestamp: Date.now()
			});
		}

		const batch = this.pendingBatches.get(queueName)!;
		batch.jobs.push(queuedJob);

		// Process immediately if batch is full
		if (batch.jobs.length >= this.maxBatchSize) {
			this.pendingBatches.delete(queueName);
			this.processBatch(batch);
		}
	}

	/**
	 * Process the next job in a queue (overridden for batching)
	 */
	protected async processNextJob(queueName: string): Promise<void> {
		const queue = this.queues.get(queueName);
		if (!queue || queue.paused || queue.activeJobs.size >= queue.options.concurrency!) {
			return;
		}

		// Find eligible jobs
		const now = new Date();
		const eligibleJobs: QueuedJob[] = [];

		for (let i = 0; i < queue.jobs.length && eligibleJobs.length < this.maxBatchSize; i++) {
			const job = queue.jobs[i];

			// Skip scheduled jobs not ready yet
			if (job.scheduledFor && job.scheduledFor > now) {
				continue;
			}

			// Skip cancelled jobs
			if (job.job.status === JobStatus.CANCELLED) {
				queue.jobs.splice(i, 1);
				i--;
				continue;
			}

			eligibleJobs.push(job);
		}

		// Remove eligible jobs from queue
		for (const job of eligibleJobs) {
			const index = queue.jobs.indexOf(job);
			if (index >= 0) {
				queue.jobs.splice(index, 1);
			}
		}

		// Add to batch for processing
		if (eligibleJobs.length > 0) {
			const batch: JobBatch = {
				queue: queueName,
				jobs: eligibleJobs,
				timestamp: Date.now()
			};

			// Process small batches immediately, larger ones are batched
			if (eligibleJobs.length === 1) {
				await this.processBatch(batch);
			} else {
				this.pendingBatches.set(queueName, batch);
			}
		}
	}

	/**
	 * Handle transport messages
	 */
	private async handleTransportMessage(message: TransportEvent): Promise<void> {
		try {
			switch (message.type) {
				case 'job:process': {
					const {
						job: jobName,
						args = [],
						queue = 'default',
						options = {},
						jobId,
						dispatchId
					} = message;
					await this.handleProcessJob(jobId, dispatchId, jobName, args, queue, options);
					break;
				}

				case 'job:cancel': {
					const { jobId, queue = 'default' } = message;
					const cancelled = await this.cancelJob(jobId, queue);
					if (cancelled) {
						await this.sendJobStatusUpdate(jobId, message.dispatchId, queue, JobStatus.CANCELLED);
					}
					break;
				}

				case 'job:cancelAll': {
					const { queue = 'default' } = message;
					await this.cancelAllJobs(queue);
					break;
				}

				case 'job:update': {
					// Handle lock release notifications
					if (message.status === 'lock_released') {
						// Trigger processing for the queue
						const queueName = message.queue;
						await this.processQueueJobs(queueName);
					}
					break;
				}
			}
		} catch (error) {
			this.error(`Error handling transport message: ${error}`);
		}
	}

	/**
	 * Handle job process message
	 */
	private async handleProcessJob(
		jobId: string,
		dispatchId: string,
		jobName: string,
		args: any[],
		queueName: string,
		messageOptions: any
	): Promise<void> {
		try {
			const entry = JobRegistry.get(jobName);

			if (!entry) {
				throw new Error(`Job class not found: ${jobName}`);
			}

			// Create the job in its owning module's context, and run it there too
			const job = ModuleContext.run(
				entry.module,
				() => new (WithId(entry.jobClass, jobId, dispatchId))(...(args || []))
			);
			jobOwners.set(job, entry.module);
			job.queueName = queueName;

			// Parse job options
			const jobOptions: JobDispatchOptions = {};

			if (messageOptions.scheduledFor) {
				jobOptions.scheduledFor =
					typeof messageOptions.scheduledFor === 'string'
						? new Date(messageOptions.scheduledFor)
						: messageOptions.scheduledFor;
			}

			if (messageOptions.priority !== undefined) {
				jobOptions.priority = Number(messageOptions.priority);
			}

			if (messageOptions.maxRetries !== undefined) {
				jobOptions.maxRetries = Number(messageOptions.maxRetries);
			}

			if (messageOptions.retryDelay !== undefined) {
				jobOptions.retryDelay = Number(messageOptions.retryDelay);
			}

			// Send initial status
			const initialStatus =
				jobOptions.scheduledFor && jobOptions.scheduledFor > new Date()
					? JobStatus.SCHEDULED_FOR_RETRY
					: JobStatus.PENDING;

			await this.sendJobStatusUpdate(job.id, job.dispatchId, queueName, initialStatus);

			// Add job to queue
			await this.addJob(job, queueName, jobOptions);
		} catch (error: any) {
			this.error(`Error processing job ${jobName}: ${error.message}`);
			await this.sendJobStatusUpdate(jobId, dispatchId, queueName, JobStatus.FAILED, error.message);
		}
	}

	/**
	 * Update worker metrics
	 */
	private updateMetrics(jobCount: number, processingTime: number): void {
		const currentAvg = this.metrics.averageProcessingTime;
		const totalJobs = this.metrics.jobsProcessed + this.metrics.jobsFailed;

		// Calculate new average
		this.metrics.averageProcessingTime =
			(currentAvg * totalJobs + processingTime) / (totalJobs + jobCount);
	}

	/**
	 * Create a new queue with the specified options
	 */
	public override async createQueue(options: WorkerQueueOptions): Promise<Worker> {
		const result = await super.createQueue(options);

		// Register the new queue with the transport
		if (this.isRunning && !this.registeredQueues.has(options.name)) {
			this.registeredQueues.add(options.name);
			await this.transport.registerWorker(this.id, Array.from(this.registeredQueues));
		}

		return result;
	}
}
