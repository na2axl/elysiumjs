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

import type { Job, JobOverlapBehavior } from './job';
import type { QueueOptions } from './queue';

/**
 * Represents a job in the queue with its metadata.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type QueuedJob = {
	/**
	 * The job instance.
	 */
	job: Job;

	/**
	 * The number of times this job has been retried.
	 */
	retries: number;

	/**
	 * The queue this job belongs to.
	 */
	queueName: string;

	/**
	 * When the job was added to the queue.
	 */
	enqueuedAt: Date;

	/**
	 * When the job is scheduled to be processed.
	 * This is used for delayed jobs or retry scheduling.
	 */
	scheduledFor?: Date;

	/**
	 * Priority of this job (lower number = higher priority).
	 * @see JobDispatchOptions.priority
	 */
	priority?: number;

	/**
	 * Maximum number of retries for this specific job.
	 * Overrides queue-level setting if specified.
	 * @see JobDispatchOptions.maxRetries
	 */
	maxRetries?: number;

	/**
	 * Delay between retries in milliseconds for this specific job.
	 * Overrides queue-level setting if specified.
	 * @see JobDispatchOptions.retryDelay
	 */
	retryDelay?: number;

	/**
	 * Defines how the job handles overlap with other instances of the same job ID.
	 * @see JobOverlapBehavior
	 */
	overlapBehavior?: JobOverlapBehavior;

	/**
	 * When using NO_OVERLAP behavior, specifies the delay in milliseconds
	 * between sequential executions of jobs with the same ID.
	 */
	overlapDelay?: number;
};

/**
 * Options for worker queues.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type WorkerQueueOptions = Omit<QueueOptions, 'transport'>;

/**
 * State associated with a job queue managed by a worker.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type QueueState = {
	/**
	 * The queue configuration options.
	 */
	options: WorkerQueueOptions;

	/**
	 * The jobs waiting to be processed.
	 */
	jobs: QueuedJob[];

	/**
	 * The jobs currently being processed.
	 */
	activeJobs: Map<string, QueuedJob>;

	/**
	 * The jobs that are waiting to be retried.
	 */
	retryingJobs: Map<string, QueuedJob>;

	/**
	 * Whether the queue is currently paused.
	 */
	paused: boolean;

	/**
	 * Whether the queue is currently being drained (completing existing jobs but not accepting new ones).
	 */
	draining: boolean;
};

/**
 * Worker status information.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export enum WorkerStatus {
	/**
	 * Worker is idle - no jobs are being processed.
	 */
	IDLE = 'idle',

	/**
	 * Worker is active - processing jobs.
	 */
	ACTIVE = 'active',

	/**
	 * Worker is paused - not accepting new jobs.
	 */
	PAUSED = 'paused',

	/**
	 * Worker is draining - completing current jobs but not accepting new ones.
	 */
	DRAINING = 'draining',

	/**
	 * Worker is stopping - gracefully shutting down.
	 */
	STOPPING = 'stopping',

	/**
	 * Worker is stopped - no longer processing jobs.
	 */
	STOPPED = 'stopped',

	/**
	 * Worker is disconnected - lost connection.
	 */
	DISCONNECTED = 'disconnected'
}

/**
 * Worker information used by the worker pool.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type WorkerInfo = {
	/**
	 * The worker ID.
	 */
	id: string;

	/**
	 * The worker status.
	 */
	status: WorkerStatus;

	/**
	 * The queues handled by this worker.
	 */
	queues: string[];

	/**
	 * The jobs being processed by this worker.
	 */
	activeJobs: number;

	/**
	 * The transport used by this worker.
	 */
	transport: string;

	/**
	 * Start time of this worker.
	 */
	startedAt: Date;

	/**
	 * Add a job to this worker.
	 */
	addJob(job: Job, queueName?: string): Promise<boolean>;

	/**
	 * Cancel a job on this worker.
	 */
	cancelJob(jobId: string, queueName?: string): Promise<boolean>;

	/**
	 * Cancel all jobs on this worker.
	 */
	cancelAllJobs(queueName?: string): Promise<number>;
};

/**
 * Standardized interface for a worker managing job queues.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export interface Worker {
	/**
	 * The worker ID.
	 */
	id: string;

	/**
	 * The worker status.
	 */
	status: WorkerStatus;

	/**
	 * Create a new queue with the specified options.
	 */
	createQueue(options: QueueOptions): Promise<Worker>;

	/**
	 * Add a job to a queue.
	 */
	addJob(job: Job, queueName?: string): Promise<Worker>;

	/**
	 * Pause a queue to stop processing new jobs.
	 */
	pause(queueName?: string): Promise<Worker>;

	/**
	 * Resume a paused queue.
	 */
	resume(queueName?: string): Promise<Worker>;

	/**
	 * Drain a queue - complete current jobs but don't accept new ones.
	 */
	drain(queueName?: string): Promise<Worker>;

	/**
	 * Clear all jobs from a queue.
	 */
	clear(queueName?: string): Promise<Worker>;

	/**
	 * Get the number of jobs in a queue.
	 */
	size(queueName?: string): Promise<number>;

	/**
	 * Get the total number of jobs across all queues.
	 */
	totalSize(): Promise<number>;

	/**
	 * Get statistics about all queues.
	 */
	getStats(): Promise<
		Record<string, { waiting: number; processing: number; paused: boolean; draining: boolean }>
	>;

	/**
	 * Get information about this worker for the worker pool.
	 */
	getInfo(): WorkerInfo;

	/**
	 * Cancel a job.
	 */
	cancelJob(jobId: string, queueName?: string): Promise<boolean>;

	/**
	 * Cancel all jobs.
	 */
	cancelAllJobs(queueName?: string): Promise<number>;

	/**
	 * Get the job with the given ID.
	 */
	getJob(jobId: string, queueName?: string): Promise<Job | null>;

	/**
	 * Start the worker.
	 */
	start(): Promise<void>;

	/**
	 * Stop the worker.
	 */
	stop(force?: boolean): Promise<void>;

	/**
	 * Set the concurrency for a queue.
	 */
	setConcurrency(queueName: string, concurrency: number): Promise<void>;
}
