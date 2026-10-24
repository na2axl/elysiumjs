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

import type { EventHandler } from '@elysiumjs/core';
import type { JobClass, JobOverlapBehavior } from './job';
import type { JobStatusInfo, Transport, TransportClass, TransportEvent } from './transport';

import { Event, InteractsWithConsole } from '@elysiumjs/core';
import { map, uid } from 'radash';

import { Job, JobStatus } from './job';
import { TransportMode } from './transport';

/**
 * Options for dispatching a job to a queue.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type JobDispatchOptions = {
	/**
	 * Schedule the job to run at a specific time.
	 */
	scheduledFor?: Date;

	/**
	 * Priority of this job (lower number = higher priority).
	 * @default 10
	 */
	priority?: number;

	/**
	 * Maximum number of retries for this job.
	 * Overrides both the job class and queue settings.
	 */
	maxRetries?: number;

	/**
	 * Delay between retries in milliseconds.
	 * Overrides both the job class and queue settings.
	 */
	retryDelay?: number;

	/**
	 * Optional job ID to use for this dispatch.
	 * If not provided, a unique ID will be generated.
	 */
	jobId?: string;

	/**
	 * A unique ID for this specific dispatch of the job.
	 * If not provided, one will be generated.
	 */
	dispatchId?: string;

	/**
	 * Defines how the job handles overlap with other instances of the same job ID.
	 * Overrides the setting from the job class.
	 */
	overlapBehavior?: JobOverlapBehavior;

	/**
	 * When using NO_OVERLAP behavior, specifies the delay in milliseconds
	 * between sequential executions of jobs with the same ID.
	 * Overrides the setting from the job class.
	 */
	overlapDelay?: number;
};

/**
 * Configuration options for a Queue.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type QueueOptions = {
	/**
	 * The name of the queue.
	 */
	name: string;

	/**
	 * The transport class to use for this queue.
	 */
	transport: TransportClass;

	/**
	 * The maximum number of concurrent jobs to process in this queue.
	 * @default 1
	 */
	concurrency?: number;

	/**
	 * The maximum number of retries for failed jobs.
	 * @default 0
	 */
	maxRetries?: number;

	/**
	 * The delay in milliseconds between retries.
	 * @default 1000
	 */
	retryDelay?: number;

	/**
	 * Whether to pause processing when an error occurs.
	 * @default false
	 */
	pauseOnError?: boolean;

	/**
	 * Configuration options for the transport.
	 * This is passed to the transport constructor.
	 */
	transportOptions?: Record<string, any>;
};

/**
 * Generated ID when dispatching jobs in queues.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type JobDispatchId = {
	/**
	 * The job ID.
	 */
	jobId: string;

	/**
	 * The dispatch ID.
	 */
	dispatchId: string;
};

/**
 * Queue class for dispatching jobs to workers.
 * @author Axel Nana <axel.nana@icloud.com>
 */
export class Queue extends InteractsWithConsole {
	/**
	 * Map of all registered queues.
	 */
	private static queues: Map<string, Queue> = new Map();

	/**
	 * Removes a queue from the registry. The caller is responsible for stopping it.
	 * @param name The name of the queue.
	 */
	public static remove(name: string): void {
		this.queues.delete(name);
	}

	/**
	 * Checks whether a queue exists.
	 * @param name The name of the queue.
	 * @returns `true` if the queue exists, `false` otherwise.
	 */
	public static exists(name: string): boolean {
		return this.queues.has(name);
	}

	/**
	 * Get a queue by name, or create it if it doesn't exist.
	 *
	 * @param name The name of the queue.
	 * @param config Optional configuration for the queue if it needs to be created.
	 * @returns The queue instance.
	 */
	public static get(name: string, config?: Omit<QueueOptions, 'name'>): Queue {
		if (!this.queues.has(name)) {
			const queue = new Queue({
				name,
				...config!
			});

			this.queues.set(name, queue);
		}

		return this.queues.get(name)!;
	}

	/**
	 * Get all registered queues.
	 *
	 * @returns A map of all registered queues.
	 */
	public static getAll(): Map<string, Queue> {
		return new Map(this.queues);
	}

	/**
	 * The name of this queue
	 */
	public readonly name: string;

	/** The in-flight or settled start of the transport. */
	private starting: Promise<void> | undefined;

	/**
	 * The transport used by this queue
	 */
	private readonly transport: Transport;

	/**
	 * The transport class for this queue.
	 */
	private transportClass?: TransportClass;

	/**
	 * The transport options for this queue. These are passed to the transport constructor.
	 */
	private transportOptions?: Record<string, any>;

	/**
	 * The queue configuration options.
	 */
	private options: QueueOptions;

	/**
	 * Array of job IDs currently being processed
	 */
	private jobs: Array<JobDispatchId> = [];

	/**
	 * Creates a new Queue instance.
	 *
	 * @param config The queue configuration.
	 */
	private constructor(config: QueueOptions) {
		super();

		this.name = config.name;
		this.transportClass = config.transport;
		this.transportOptions = config.transportOptions;

		// Store queue options for worker configuration
		this.options = {
			concurrency: config.concurrency ?? 1,
			maxRetries: config.maxRetries ?? 0,
			retryDelay: config.retryDelay ?? 1000,
			pauseOnError: config.pauseOnError ?? false,
			...config
		};

		// Initialize the transport
		this.transport = new this.transportClass(TransportMode.PRODUCER, this.transportOptions);

		// Register message handler for job status updates
		this.transport.onMessage(this.handleTransportMessage.bind(this));
	}

	public on<TData, TSource = any>(
		event: TransportEvent['type'],
		handler: EventHandler<TData, TSource> | never
	) {
		Event.on(`elysium:heracles:queue:${this.name}:${event}`, handler);
	}

	public once<TData, TSource = any>(
		event: TransportEvent['type'],
		handler: EventHandler<TData, TSource> | never
	) {
		Event.once(`elysium:heracles:queue:${this.name}:${event}`, handler);
	}

	private emit<TData, TSource = any>(
		event: TransportEvent['type'],
		data: TData,
		source: TSource | null = null
	): void {
		Event.emit(`elysium:heracles:queue:${this.name}:${event}`, data, source);
	}

	/**
	 * Handle messages from the transport
	 *
	 * @param message The message from the transport
	 */
	private async handleTransportMessage(message: TransportEvent): Promise<void> {
		switch (message.type) {
			case 'job:status':
			case 'job:result':
				// Update job status for both status and result messages
				if (message.queue === this.name) {
					// For result messages, log completion
					if (message.type === 'job:result') {
						this.info(`Job ${message.jobId} completed with status: ${message.status}`);
					}

					// Get the existing status if available
					const existingStatus = await this.getJobStatus({
						jobId: message.jobId,
						dispatchId: message.dispatchId
					});

					// Preserve creation time if we already have it
					const createdAt = existingStatus?.createdAt ?? new Date().toISOString();

					// Update job status
					this.updateJobStatus(message.jobId, message.dispatchId, {
						jobId: message.jobId,
						dispatchId: message.dispatchId,
						queue: message.queue,
						status: message.status,
						error: message.error,
						retries: message.retries ?? existingStatus?.retries ?? 0,
						createdAt: createdAt,
						startedAt: (message as any).startedAt ?? existingStatus?.startedAt,
						completedAt: message.completedAt ?? existingStatus?.completedAt,
						updatedAt: message.updatedAt ?? new Date().toISOString()
					});
				}
				break;
		}

		this.emit(message.type, message, this);
	}

	/**
	 * Update the status of a job.
	 *
	 * @param jobId The ID of the job.
	 * @param dispatchID The dispatch ID of the job.
	 * @param status The new status information.
	 */
	private updateJobStatus(jobId: string, dispatchId: string, status: JobStatusInfo): void {
		// Perform cleanup for completed jobs
		if (
			status.status === JobStatus.COMPLETED ||
			status.status === JobStatus.FAILED ||
			status.status === JobStatus.CANCELLED
		) {
			// TODO: In the future, this could trigger metrics collection or other cleanup tasks
			this.debug(`Job ${jobId} (${dispatchId}) reached terminal state: ${status.status}`);
		}
	}

	/**
	 * Dispatch a job to this queue
	 *
	 * @param name The name of the job to dispatch
	 * @param args The arguments to pass to the job constructor
	 * @param options Optional dispatch options
	 * @returns A promise that resolves to the created job instance
	 */
	public async dispatch<T extends Job, TClass extends JobClass<T> = JobClass<T>>(
		job: TClass,
		name: string,
		args: ConstructorParameters<TClass> = [] as any,
		options: JobDispatchOptions = {}
	): Promise<JobDispatchId> {
		// Create initial timestamp
		const now = new Date();
		const createdAt = now.toISOString();

		// Generate or use provided job ID
		const jobId = options.jobId ?? job.generateJobId(...args);

		// Generate or use provided dispatch ID
		const dispatchId = options.dispatchId ?? `dispatch_${Date.now()}_${uid(8)}`;

		// Initialize job status
		const initialStatus: JobStatusInfo = {
			jobId,
			dispatchId,
			queue: this.name,
			status:
				options.scheduledFor && options.scheduledFor > now
					? JobStatus.SCHEDULED_FOR_RETRY
					: JobStatus.PENDING,
			retries: 0,
			createdAt: createdAt,
			updatedAt: createdAt
		};

		this.updateJobStatus(jobId, dispatchId, initialStatus);
		this.debug(
			`Dispatching job ${jobId} (dispatch: ${dispatchId}, name: ${name}) to queue '${this.name}'`
		);

		// Use transport for dispatching
		try {
			const message: TransportEvent = {
				type: 'job:process',
				job: name,
				jobId,
				dispatchId,
				args,
				queue: this.name,
				options: {
					scheduledFor: options.scheduledFor?.toISOString(),
					priority: options.priority,
					maxRetries: options.maxRetries,
					retryDelay: options.retryDelay,
					overlapBehavior: options.overlapBehavior,
					overlapDelay: options.overlapDelay
				}
			};

			await this.transport.send(message);
			return { jobId: initialStatus.jobId, dispatchId };
		} catch (error: any) {
			this.error(`Failed to dispatch job ${name} to queue '${this.name}': ${error.message}`);

			// Update job status to failed
			this.updateJobStatus(jobId, dispatchId, {
				jobId: initialStatus.jobId,
				dispatchId,
				queue: this.name,
				status: JobStatus.FAILED,
				error: error.message,
				retries: 0,
				createdAt: initialStatus.createdAt,
				completedAt: new Date().toISOString(),
				updatedAt: new Date().toISOString()
			});

			throw error;
		}
	}

	/**
	 * Cancel a job in this queue.
	 *
	 * @param id The ID of the dispatched job to cancel.
	 * @returns A promise that resolves to true if the job was found and canceled.
	 */
	public async cancelJob(id: JobDispatchId): Promise<boolean> {
		this.debug(`Canceling job ${id.jobId} (${id.dispatchId}) in queue '${this.name}'`);

		// Use transport interface
		try {
			const message: TransportEvent = {
				type: 'job:cancel',
				jobId: id.jobId,
				dispatchId: id.dispatchId,
				queue: this.name
			};

			await this.transport.send(message);
			return true;
		} catch (error) {
			this.error(`Failed to cancel job ${id.jobId}: ${error}`);
			return false;
		}
	}

	/**
	 * Cancel all jobs in this queue.
	 *
	 * @returns A promise that resolves to the number of jobs canceled.
	 */
	public async cancelAllJobs(): Promise<number> {
		this.debug(`Canceling all jobs in queue '${this.name}'`);

		try {
			const message: TransportEvent = {
				type: 'job:cancelAll',
				queue: this.name
			};

			await this.transport.send(message);
		} catch (error) {
			this.error(`Failed to cancel all jobs: ${error}`);
		}

		// We don't know how many were canceled
		return 0;
	}

	/**
	 * Get the status of a job.
	 *
	 * @param id The ID of the job.
	 * @returns A promise that resolves to the job status or null if not found
	 */
	public async getJobStatus(id: JobDispatchId): Promise<JobStatusInfo | null> {
		// Try to get from transport
		try {
			const status = await this.transport.getJobStatus(id.jobId, id.dispatchId, this.name);
			if (status) {
				this.debug(
					`Retrieved job ${id.jobId} (${id.dispatchId}) status from transport: ${status.status}`
				);
				return status;
			}
		} catch (error) {
			this.warning(`Failed to get job status from transport: ${error}`);
		}

		return null;
	}

	/**
	 * Get all jobs in this queue
	 *
	 * @returns An array of job IDs
	 */
	public getAllJobs(): Array<JobDispatchId> {
		return Array.from(this.jobs);
	}

	/**
	 * Get jobs by status
	 *
	 * @param status The status to filter by
	 * @returns An array of jobs with the specified status
	 */
	public async getJobsByStatus(status: JobStatus): Promise<JobDispatchId[]> {
		const result: JobDispatchId[] = [];

		for (const [jobId, statusInfo] of await map(
			this.jobs,
			async (id) => [id, await this.getJobStatus(id)] as [JobDispatchId, JobStatusInfo | null]
		)) {
			if (statusInfo?.status === status) {
				result.push(jobId);
			}
		}

		return result;
	}

	/**
	 * Start the queue's transport. Starting is idempotent: concurrent and repeated calls share
	 * one in-flight start, and the transport is started once until {@link Queue.stop} is called.
	 *
	 * @returns A promise that resolves when the transport has started.
	 */
	public start(): Promise<void> {
		if (!this.transport) return Promise.resolve();

		if (!this.starting) {
			const transport = this.transport;
			this.starting = (async () => {
				await transport.start();
				this.info(`Queue '${this.name}' transport started`);
			})().catch((error) => {
				// Let a later call retry.
				this.starting = undefined;
				throw error;
			});
		}

		return this.starting;
	}

	/**
	 * Stop the queue's transport.
	 *
	 * @returns A promise that resolves when the transport has stopped.
	 */
	public async stop(): Promise<void> {
		if (this.transport) {
			const pending = this.starting;
			this.starting = undefined;
			await pending?.catch(() => {});
			await this.transport.stop();
			this.info(`Queue '${this.name}' transport stopped`);
		}
	}

	/**
	 * Get the queue options.
	 *
	 * @returns The queue options.
	 */
	public getOptions(): QueueOptions {
		return { ...this.options };
	}

	/**
	 * Update the queue options.
	 *
	 * @param options The new options
	 */
	public updateOptions(options: Partial<QueueOptions>): void {
		this.options = {
			...this.options,
			...options
		};
	}
}
