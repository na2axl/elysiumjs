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

import type { Job } from '../job';
import type { JobDispatchOptions } from '../queue';
import type { Transport } from '../transport';
import type { QueuedJob, QueueState, Worker, WorkerInfo, WorkerQueueOptions } from '../worker';

import { InteractsWithConsole, Runtime } from '@elysiumjs/core';
import { sort, uid } from 'radash';

import { JobStatus } from '../job';
import { WorkerStatus } from '../worker';

/**
 * Base class for workers that manages multiple job queues and processes them in parallel.
 * Each queue processes its jobs sequentially by default, but can be configured for concurrency.
 * @author Axel Nana <axel.nana@workbud.com>
 *
 * @template TTransport The type of transport used by the worker.
 */
export abstract class BaseWorker<TTransport extends Transport>
	extends InteractsWithConsole
	implements Worker
{
	/**
	 * The worker ID.
	 */
	readonly #id: string;

	/**
	 * Transport instance used for Redis communication
	 */
	protected transport: TTransport = null!;

	/**
	 * The queues managed by this worker.
	 */
	protected queues: Map<string, QueueState> = new Map();

	/**
	 * The default queue name.
	 */
	protected defaultQueueName: string = 'default';

	/**
	 * The default transport used by this worker.
	 */
	protected defaultTransport?: Transport;

	/**
	 * The current status of this worker.
	 */
	protected workerStatus: WorkerStatus = WorkerStatus.IDLE;

	/**
	 * When this worker was started.
	 */
	protected startedAt: Date = new Date();

	/**
	 * Interval in milliseconds to check for scheduled jobs.
	 */
	protected scheduledJobInterval: number = 1000;

	/**
	 * Timer for checking scheduled jobs.
	 */
	private scheduledJobTimer?: NodeJS.Timeout;

	constructor(id?: string) {
		super();

		this.#id = id ?? uid(24);

		// Initialize the default queue
		this.createQueue({ name: this.defaultQueueName });
	}

	/**
	 * Gets the worker ID.
	 * @returns The worker ID.
	 */
	public get id(): string {
		return this.#id;
	}

	/**
	 * Gets the worker status.
	 */
	public get status(): WorkerStatus {
		return this.workerStatus;
	}

	/**
	 * Creates a new queue with the specified options.
	 *
	 * @param options The queue configuration options.
	 * @returns The Worker instance for method chaining.
	 */
	public async createQueue(options: WorkerQueueOptions): Promise<Worker> {
		if (this.queues.has(options.name)) {
			this.debug(`Queue with name '${options.name}' already exists`);
			return this;
		}

		const queueState: QueueState = {
			options: {
				...options,
				concurrency: options.concurrency || 1,
				maxRetries: options.maxRetries || 0,
				retryDelay: options.retryDelay || 1000,
				pauseOnError: options.pauseOnError || false
			},
			jobs: [],
			activeJobs: new Map(),
			retryingJobs: new Map(),
			paused: false,
			draining: false
		};

		this.queues.set(options.name, queueState);
		this.debug(`Created queue '${options.name}'`);

		return this;
	}

	/**
	 * Adds a job to the specified queue or the default queue if not specified.
	 *
	 * @param job The job to add to the queue.
	 * @param queueName Optional name of the queue to add the job to. Defaults to the default queue.
	 * @param options Additional options for job scheduling
	 * @returns The Worker instance for method chaining.
	 * @throws Error if the specified queue does not exist.
	 */
	public async addJob(
		job: Job,
		queueName: string = this.defaultQueueName,
		options: JobDispatchOptions = {}
	): Promise<Worker> {
		const queue = this.queues.get(queueName);

		if (!queue) {
			this.error(`Queue '${queueName}' does not exist`);
			throw new Error(`Queue '${queueName}' does not exist`);
		}

		if (queue.draining) {
			this.warning(`Queue '${queueName}' is draining, job ${job.id} will not be added`);
			throw new Error(`Queue '${queueName}' is draining`);
		}

		// Set job's queue name
		job.queueName = queueName;

		const queuedJob: QueuedJob = {
			job,
			retries: job.retries,
			queueName,
			enqueuedAt: new Date(),
			scheduledFor: options.scheduledFor,
			priority: options.priority ?? 10, // Default priority (lower = higher priority)
			maxRetries: options.maxRetries,
			retryDelay: options.retryDelay,
			overlapBehavior: options.overlapBehavior,
			overlapDelay: options.overlapDelay
		};

		// Add job to queue
		queue.jobs.push(queuedJob);

		// Sort jobs by priority, then by scheduled time, then by enqueued time
		queue.jobs = sort(
			sort(
				sort(queue.jobs, (job) => job.enqueuedAt.getTime()),
				(job) => (job.scheduledFor ? job.scheduledFor.getTime() : 0)
			),
			(job) => job.priority ?? 10
		);

		this.debug(`Added job ${job.id} to queue '${queueName}'`);

		// Update worker status if needed
		if (this.workerStatus === WorkerStatus.IDLE) {
			this.workerStatus = WorkerStatus.ACTIVE;
		}

		// Start processing if the queue is not paused and not already at max concurrency
		if (!queue.paused && queue.activeJobs.size < queue.options.concurrency!) {
			try {
				this.processQueueJobs(queueName);
			} catch (error) {
				this.error(`Error processing next job in queue '${queueName}': ${error}`);
			}
		}

		return this;
	}

	/**
	 * Pauses a queue, preventing it from processing new jobs.
	 *
	 * @param queueName The name of the queue to pause. If not specified, pauses all queues.
	 * @returns The Worker instance for method chaining.
	 */
	public async pause(queueName?: string): Promise<Worker> {
		if (queueName) {
			const queue = this.queues.get(queueName);
			if (queue) {
				queue.paused = true;
				this.info(`Paused queue '${queueName}'`);
			} else {
				this.warning(`Cannot pause non-existent queue '${queueName}'`);
			}
		} else {
			for (const name of this.queues.keys()) {
				await this.pause(name);
			}

			// If all queues are paused and no jobs are processing, set worker status to PAUSED
			if (
				Array.from(this.queues.values()).every((q) => q.paused) &&
				Array.from(this.queues.values()).every((q) => q.activeJobs.size === 0)
			) {
				this.workerStatus = WorkerStatus.PAUSED;
				this.info(`Worker ${this.id} is now paused`);
			}
		}
		return this;
	}

	/**
	 * Resumes a paused queue.
	 *
	 * @param queueName The name of the queue to resume. If not specified, resumes all queues.
	 * @returns The Worker instance for method chaining.
	 */
	public async resume(queueName?: string): Promise<Worker> {
		if (queueName) {
			const queue = this.queues.get(queueName);
			if (queue) {
				queue.paused = false;
				this.info(`Resumed queue '${queueName}'`);

				// Set worker status to ACTIVE if it was PAUSED
				if (this.workerStatus === WorkerStatus.PAUSED) {
					this.workerStatus = WorkerStatus.ACTIVE;
				}

				// Process jobs in queue
				await this.processQueueJobs(queueName);
			} else {
				this.warning(`Cannot resume non-existent queue '${queueName}'`);
			}
		} else {
			for (const name of this.queues.keys()) {
				await this.resume(name);
			}

			// If any queue has jobs, worker should be ACTIVE
			if (
				Array.from(this.queues.values()).some((q) => q.jobs.length > 0 || q.activeJobs.size > 0)
			) {
				this.workerStatus = WorkerStatus.ACTIVE;
				this.info(`Worker ${this.id} is now active`);
			}
		}
		return this;
	}

	/**
	 * Drains a queue, completing all current jobs but not accepting new ones.
	 *
	 * @param queueName The name of the queue to drain. If not specified, drains all queues.
	 * @returns The Worker instance for method chaining.
	 */
	public async drain(queueName?: string): Promise<Worker> {
		if (queueName) {
			const queue = this.queues.get(queueName);
			if (queue) {
				queue.draining = true;
				this.info(`Draining queue '${queueName}'`);
			} else {
				this.warning(`Cannot drain non-existent queue '${queueName}'`);
			}
		} else {
			// Set all queues to draining
			for (const name of this.queues.keys()) {
				await this.drain(name);
			}

			// Update worker status
			this.workerStatus = WorkerStatus.DRAINING;
			this.info(`Worker ${this.id} is now draining`);
		}
		return this;
	}

	/**
	 * Clears all jobs from a queue.
	 *
	 * @param queueName The name of the queue to clear. If not specified, clears all queues.
	 * @returns The Worker instance for method chaining.
	 */
	public async clear(queueName?: string): Promise<Worker> {
		if (queueName) {
			const queue = this.queues.get(queueName);
			if (queue) {
				const jobCount = queue.jobs.length;

				// Cancel all jobs in the queue
				for (const queuedJob of queue.jobs) {
					queuedJob.job.cancel();
				}

				queue.jobs = [];
				this.info(`Cleared ${jobCount} jobs from queue '${queueName}'`);
			} else {
				this.warning(`Cannot clear non-existent queue '${queueName}'`);
			}
		} else {
			for (const [name, queue] of this.queues.entries()) {
				const jobCount = queue.jobs.length;

				// Cancel all jobs in the queue
				for (const queuedJob of queue.jobs) {
					queuedJob.job.cancel();
				}

				queue.jobs = [];
				this.info(`Cleared ${jobCount} jobs from queue '${name}'`);
			}

			// If all queues are empty and no jobs are processing, worker is IDLE
			if (
				Array.from(this.queues.values()).every(
					(q) => q.jobs.length === 0 && q.activeJobs.size === 0
				)
			) {
				this.workerStatus = WorkerStatus.IDLE;
			}
		}
		return this;
	}

	/**
	 * Gets the number of jobs in a queue.
	 *
	 * @param queueName The name of the queue to get the size of.
	 * @returns The number of jobs in the queue.
	 * @throws Error if the specified queue does not exist.
	 */
	public async size(queueName: string = this.defaultQueueName): Promise<number> {
		const queue = this.queues.get(queueName);
		if (!queue) {
			throw new Error(`Queue '${queueName}' does not exist`);
		}
		return queue.jobs.length + queue.activeJobs.size;
	}

	/**
	 * Gets the total number of jobs across all queues.
	 *
	 * @returns The total number of jobs.
	 */
	public async totalSize(): Promise<number> {
		let total = 0;
		for (const queue of this.queues.values()) {
			total += queue.jobs.length + queue.activeJobs.size;
		}
		return total;
	}

	/**
	 * Gets statistics about all queues.
	 *
	 * @returns An object containing statistics about each queue.
	 */
	public async getStats(): Promise<
		Record<
			string,
			{
				waiting: number;
				retrying: number;
				processing: number;
				paused: boolean;
				draining: boolean;
			}
		>
	> {
		const stats: Record<
			string,
			{
				waiting: number;
				retrying: number;
				processing: number;
				paused: boolean;
				draining: boolean;
			}
		> = {};

		for (const [name, queue] of this.queues.entries()) {
			stats[name] = {
				waiting: queue.jobs.length,
				retrying: queue.retryingJobs.size,
				processing: queue.activeJobs.size,
				paused: queue.paused,
				draining: queue.draining
			};
		}

		return stats;
	}

	/**
	 * Gets information about this worker for the worker pool.
	 *
	 * @returns Worker information object
	 */
	public getInfo(): WorkerInfo {
		// Calculate total active jobs
		let activeJobs = 0;
		for (const queue of this.queues.values()) {
			activeJobs += queue.activeJobs.size;
		}

		// Get queue names
		const queueNames = Array.from(this.queues.keys());

		// Determine transport type
		const transportType = this.defaultTransport ? this.defaultTransport.constructor.name : 'None';

		// Create a wrapper for addJob that returns boolean instead of Worker
		const addJobWrapper = async (job: Job, queueName?: string): Promise<boolean> => {
			try {
				await this.addJob(job, queueName);
				return true;
			} catch (error) {
				return false;
			}
		};

		return {
			id: this.id,
			status: this.workerStatus,
			queues: queueNames,
			activeJobs,
			transport: transportType,
			startedAt: this.startedAt,
			addJob: addJobWrapper,
			cancelJob: this.cancelJob.bind(this),
			cancelAllJobs: this.cancelAllJobs.bind(this)
		};
	}

	/**
	 * Cancels a job by its ID.
	 *
	 * @param jobId The ID of the job to cancel.
	 * @param queueName Optional queue name to search in. If not provided, searches all queues.
	 * @returns `true` if the job was found and canceled, false otherwise.
	 */
	public async cancelJob(jobId: string, queueName?: string): Promise<boolean> {
		if (queueName) {
			return this.cancelJobInQueue(jobId, queueName);
		} else {
			for (const name of this.queues.keys()) {
				if (await this.cancelJobInQueue(jobId, name)) {
					return true;
				}
			}
			return false;
		}
	}

	/**
	 * Cancels all jobs in a queue.
	 *
	 * @param queueName The name of the queue to cancel jobs from. If not provided, cancels jobs in all queues.
	 * @returns The number of jobs canceled.
	 */
	public async cancelAllJobs(queueName?: string): Promise<number> {
		let canceledCount = 0;
		if (queueName) {
			const queue = this.queues.get(queueName);
			if (queue) {
				// Cancel waiting jobs
				canceledCount = queue.jobs.length;
				for (const queuedJob of queue.jobs) {
					queuedJob.job.cancel();
				}

				// Try to cancel running jobs
				for (const [_, activeJob] of queue.activeJobs.entries()) {
					if (activeJob.job.cancel()) {
						canceledCount++;
					}
				}

				this.info(`Canceled ${canceledCount} jobs in queue '${queueName}'`);
			}
		} else {
			for (const [name, queue] of this.queues.entries()) {
				// Cancel waiting jobs
				let count = queue.jobs.length;
				for (const queuedJob of queue.jobs) {
					queuedJob.job.cancel();
				}

				// Try to cancel running jobs
				for (const [_, activeJob] of queue.activeJobs.entries()) {
					if (activeJob.job.cancel()) {
						count++;
					}
				}

				canceledCount += count;
				this.info(`Canceled ${count} jobs in queue '${name}'`);
			}
		}

		// Update worker status if needed
		if (
			canceledCount > 0 &&
			Array.from(this.queues.values()).every((q) => q.jobs.length === 0 && q.activeJobs.size === 0)
		) {
			this.workerStatus = WorkerStatus.IDLE;
		}

		return canceledCount;
	}

	/**
	 * Get a job by its ID.
	 *
	 * @param jobId The ID of the job to get.
	 * @param queueName Optional queue name to search in. If not provided, searches all queues.
	 * @returns The job if found, null otherwise.
	 */
	public async getJob(jobId: string, queueName?: string): Promise<Job | null> {
		if (queueName) {
			const queue = this.queues.get(queueName);
			if (queue) {
				// Check waiting jobs
				const queuedJob = queue.jobs.find((j) => j.job.id === jobId);
				if (queuedJob) {
					return queuedJob.job;
				}

				// Check active jobs
				const activeJob = queue.activeJobs.get(jobId);
				if (activeJob) {
					return activeJob.job;
				}
			}
		} else {
			for (const queue of this.queues.values()) {
				// Check waiting jobs
				const queuedJob = queue.jobs.find((j) => j.job.id === jobId);
				if (queuedJob) {
					return queuedJob.job;
				}

				// Check active jobs
				const activeJob = queue.activeJobs.get(jobId);
				if (activeJob) {
					return activeJob.job;
				}
			}
		}

		return null;
	}

	/**
	 * Start the worker.
	 */
	public async start(): Promise<void> {
		this.workerStatus = WorkerStatus.ACTIVE;
		this.startedAt = new Date();

		// Start the transport if available
		if (this.defaultTransport) {
			await this.defaultTransport.start();
		}

		// Start processing jobs in all queues
		for (const queueName of this.queues.keys()) {
			await this.processQueueJobs(queueName);
		}

		// Start timer for scheduled jobs
		this.startScheduledJobTimer();

		this.info(`Worker ${this.id} started`);
	}

	/**
	 * Stop the worker.
	 *
	 * @param force If true, cancel all running jobs. If false, allow them to complete.
	 */
	public async stop(force: boolean = false): Promise<void> {
		this.workerStatus = WorkerStatus.STOPPING;

		// Stop scheduled job timer
		this.stopScheduledJobTimer();

		if (force) {
			// Cancel all jobs
			await this.cancelAllJobs();

			// Clear all queues
			for (const queueName of this.queues.keys()) {
				await this.clear(queueName);
			}
		} else {
			// Set all queues to draining
			for (const queueName of this.queues.keys()) {
				await this.drain(queueName);
			}

			// Wait for all queues to finish processing
			const allQueuesEmpty = (): boolean => {
				return Array.from(this.queues.values()).every((q) => q.activeJobs.size === 0);
			};

			if (!allQueuesEmpty()) {
				this.info(
					`Worker ${this.id} waiting for ${Array.from(this.queues.values()).reduce((acc, q) => acc + q.activeJobs.size, 0)} jobs to complete`
				);

				// Wait for queues to empty
				while (!allQueuesEmpty()) {
					await new Promise((resolve) => setTimeout(resolve, 100));
				}
			}
		}

		// Stop the transport if available
		if (this.defaultTransport) {
			await this.defaultTransport.stop();
		}

		this.workerStatus = WorkerStatus.STOPPED;
		this.info(`Worker ${this.id} stopped`);
	}

	/**
	 * Set the concurrency for a queue.
	 *
	 * @param queueName The name of the queue.
	 * @param concurrency The new concurrency value.
	 */
	public async setConcurrency(queueName: string, concurrency: number): Promise<void> {
		const queue = this.queues.get(queueName);

		if (!queue) {
			this.error(`Cannot set concurrency: Queue '${queueName}' does not exist`);
			throw new Error(`Queue '${queueName}' does not exist`);
		}

		if (concurrency < 1) {
			this.warning(`Invalid concurrency value ${concurrency}, using 1 instead`);
			concurrency = 1;
		}

		queue.options.concurrency = concurrency;
		this.info(`Set concurrency for queue '${queueName}' to ${concurrency}`);

		// Process more jobs if we've increased concurrency
		return this.processQueueJobs(queueName);
	}

	/**
	 * Start the timer for checking scheduled jobs.
	 */
	private startScheduledJobTimer(): void {
		if (this.scheduledJobTimer) {
			clearInterval(this.scheduledJobTimer);
		}

		this.scheduledJobTimer = setInterval(() => {
			this.checkScheduledJobs();
		}, this.scheduledJobInterval);
	}

	/**
	 * Stop the timer for checking scheduled jobs.
	 */
	private stopScheduledJobTimer(): void {
		if (this.scheduledJobTimer) {
			clearInterval(this.scheduledJobTimer);
			this.scheduledJobTimer = undefined;
		}
	}

	/**
	 * Check for jobs that are scheduled to run now.
	 */
	private checkScheduledJobs(): void {
		const now = new Date();

		for (const [queueName, queue] of this.queues.entries()) {
			if (queue.paused || queue.draining) {
				continue;
			}

			// Look for scheduled jobs that are ready to run
			const readyJobs = queue.jobs.filter((job) => job.scheduledFor && job.scheduledFor <= now);

			// Remove the scheduledFor timestamp to make them eligible for processing
			for (const job of readyJobs) {
				job.scheduledFor = undefined;
			}

			// Start processing if queue is not at capacity
			if (readyJobs.length > 0 && queue.activeJobs.size < queue.options.concurrency!) {
				this.processQueueJobs(queueName);
			}
		}
	}

	/**
	 * Processes the next job in the specified queue.
	 *
	 * @param queueName The name of the queue to process.
	 */
	protected abstract processNextJob(queueName: string): Promise<void>;

	/**
	 * Processes jobs in a queue up to the concurrency limit.
	 *
	 * @param queueName The name of the queue to process.
	 * @returns A promise that resolves when job processing has been initiated.
	 */
	protected async processQueueJobs(queueName: string): Promise<void> {
		const queue = this.queues.get(queueName);
		if (!queue || queue.paused) {
			return;
		}

		// Start processing jobs up to the concurrency limit
		const promises: Promise<void>[] = [];

		while (promises.length < queue.options.concurrency!) {
			promises.push(this.processNextJob(queueName));
		}

		// Wait for all processing to start (not for jobs to complete)
		await Promise.all(promises);

		const states = Array.from(this.queues.values());

		// Update worker status
		if (states.some((q) => q.activeJobs.size > 0)) {
			this.workerStatus = WorkerStatus.ACTIVE;
		} else if (states.every((q) => q.jobs.length === 0 && q.activeJobs.size === 0)) {
			this.workerStatus = WorkerStatus.IDLE;
		}

		if (states.some((q) => q.jobs.length > 0)) {
			await Runtime.get().sleep(10);
			setImmediate(() => this.processQueueJobs(queueName));
		}
	}

	/**
	 * Send job status update
	 * @param jobId Job ID
	 * @param queue Queue name
	 * @param status Job status
	 * @param error Optional error message
	 */
	protected async sendJobStatusUpdate(
		jobId: string,
		dispatchId: string,
		queue: string,
		status: JobStatus,
		error?: string
	): Promise<void> {
		try {
			// Direct call to updateJobStatus (required by Transport interface)
			await this.transport.updateJobStatus(jobId, dispatchId, queue, {
				dispatchId,
				status,
				error,
				retries: 0,
				startedAt: status === JobStatus.RUNNING ? new Date().toISOString() : undefined,
				completedAt:
					status === JobStatus.COMPLETED ||
					status === JobStatus.FAILED ||
					status === JobStatus.CANCELLED
						? new Date().toISOString()
						: undefined,
				updatedAt: Date.now().toString()
			});
		} catch (error) {
			this.error(`Error sending job status update: ${error}`);
		}
	}

	/**
	 * Cancels a job in a specific queue.
	 *
	 * @param jobId The ID of the job to cancel.
	 * @param queueName The name of the queue to search in.
	 * @returns `true` if the job was found and canceled, false otherwise.
	 */
	private async cancelJobInQueue(jobId: string, queueName: string): Promise<boolean> {
		const queue = this.queues.get(queueName);
		if (!queue) {
			return false;
		}

		// Find the job in the waiting queue
		const jobIndex = queue.jobs.findIndex((job) => job.job.id === jobId);
		if (jobIndex >= 0) {
			// Mark the job as canceled
			const canceled = queue.jobs[jobIndex].job.cancel();
			if (canceled) {
				// Remove the job from the queue
				queue.jobs.splice(jobIndex, 1);
				this.info(`Canceled job ${jobId} in queue '${queueName}'`);
				return true;
			}
		}

		// Check active jobs
		if (queue.activeJobs.has(jobId)) {
			const activeJob = queue.activeJobs.get(jobId)!;
			const canceled = activeJob.job.cancel();

			if (canceled) {
				this.info(`Canceled running job ${jobId} in queue '${queueName}'`);
				return true;
			}
		}

		return false;
	}
}
