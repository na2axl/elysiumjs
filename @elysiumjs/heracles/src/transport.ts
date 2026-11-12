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

import type { JobDispatchOptions } from './queue';

/**
 * Discriminated union of all events carried by a transport channel.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type TransportEvent =
	| TransportProcessMessage
	| TransportCancelMessage
	| TransportCancelAllMessage
	| TransportJobStatusMessage
	| TransportWorkerStatusMessage
	| TransportJobResultMessage
	| TransportWorkerRegistrationMessage
	| TransportWorkerReadyMessage
	| TransportJobUpdateMessage;

/**
 * Message sent to process a job.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type TransportProcessMessage = {
	/**
	 * The type of message.
	 */
	type: 'job:process';

	/**
	 * The name of the job to process. It should match the name of the job class,
	 * or the alias in the Service container.
	 */
	job: string;

	/**
	 * Arguments to pass to the job constructor.
	 */
	args: unknown[];

	/**
	 * The name of the queue to process the job.
	 */
	queue: string;

	/**
	 * The ID of the job.
	 * When creating a new job, this will be generated if not provided.
	 */
	jobId: string;

	/**
	 * The dispatch ID of the job.
	 * This is unique for each dispatch, even if the job ID is the same.
	 */
	dispatchId: string;

	/**
	 * Optional job dispatch configuration.
	 * Note: scheduledFor is transmitted as ISO string instead of Date object.
	 */
	options?: Omit<JobDispatchOptions, 'scheduledFor'> & {
		/**
		 * When the job should be scheduled to run (ISO string).
		 */
		scheduledFor?: string;
	};
};

/**
 * Message sent to cancel a job (by ID).
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type TransportCancelMessage = {
	/**
	 * The type of message.
	 */
	type: 'job:cancel';

	/**
	 * The ID of the job to cancel.
	 */
	jobId: string;

	/**
	 * The ID of the dispatch.
	 */
	dispatchId: string;

	/**
	 * The name of the queue where the job is located.
	 */
	queue: string;
};

/**
 * Message sent to cancel all jobs.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type TransportCancelAllMessage = {
	/**
	 * The type of message.
	 */
	type: 'job:cancelAll';

	/**
	 * The name of the queue to cancel all jobs in.
	 */
	queue: string;
};

/**
 * Message with job status information.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type TransportJobStatusMessage = {
	/**
	 * The type of message.
	 */
	type: 'job:status';

	/**
	 * The ID of the job.
	 */
	jobId: string;

	/**
	 * The ID of the dispatch that created the job.
	 */
	dispatchId: string;

	/**
	 * The name of the queue the job belongs to.
	 */
	queue: string;

	/**
	 * The current status of the job.
	 */
	status: string;

	/**
	 * The error message if the job failed.
	 */
	error?: string;

	/**
	 * The number of retries attempted.
	 */
	retries?: number;

	/**
	 * Timestamp when the job started.
	 */
	startedAt?: string;

	/**
	 * Timestamp when the job completed or failed.
	 */
	completedAt?: string;

	/**
	 * Timestamp when this status update was created.
	 */
	updatedAt?: string;

	/**
	 * Timestamp when the job was created.
	 */
	createdAt?: string;
};

/**
 * Message with worker status information.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type TransportWorkerStatusMessage = {
	/**
	 * The type of message.
	 */
	type: 'worker:status';

	/**
	 * The ID of the worker.
	 */
	workerId: string;

	/**
	 * The queues this worker is handling.
	 */
	queues: string[];

	/**
	 * The current status of the worker.
	 */
	status: 'active' | 'paused' | 'draining' | 'stopped';

	/**
	 * The number of jobs currently being processed by this worker.
	 */
	processing: number;

	/**
	 * The number of jobs waiting in this worker's queues.
	 */
	waiting: number;
};

/**
 * Message with job results.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type TransportJobResultMessage = {
	/**
	 * The type of message.
	 */
	type: 'job:result';

	/**
	 * The ID of the job.
	 */
	jobId: string;

	/**
	 * The ID of the dispatch that created the job.
	 */
	dispatchId: string;

	/**
	 * The name of the queue the job belongs to.
	 */
	queue: string;

	/**
	 * The final status of the job.
	 */
	status: string;

	/**
	 * The error message if the job failed.
	 */
	error?: string;

	/**
	 * Timestamp when the job completed or failed.
	 */
	completedAt: string;

	/**
	 * Timestamp when this update was created.
	 */
	updatedAt?: string;

	/**
	 * The number of retries that were attempted.
	 */
	retries?: number;
};

/**
 * Message for worker registration.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type TransportWorkerRegistrationMessage = {
	/**
	 * The type of message.
	 */
	type: 'worker:register' | 'worker:unregister';

	/**
	 * The ID of the worker.
	 */
	workerId: string;

	/**
	 * The queues the worker handles (for registration).
	 */
	queues?: string[];
};

/**
 * Message indicating a worker is ready.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type TransportWorkerReadyMessage = {
	/**
	 * The type of message.
	 */
	type: 'worker:ready';

	/**
	 * The ID of the worker.
	 */
	id: string;

	/**
	 * The queues the worker handles.
	 */
	queues: string[];

	/**
	 * The timestamp when the worker became ready.
	 */
	timestamp?: number;

	/**
	 * The worker status.
	 */
	status?: string;
};

/**
 * Job status information.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export interface JobStatusInfo {
	/**
	 * The ID of the job.
	 */
	jobId: string;

	/**
	 * The dispatch ID of the job.
	 * This uniquely identifies a specific dispatch of a job, even if the job ID is the same.
	 */
	dispatchId: string;

	/**
	 * The name of the queue the job belongs to.
	 */
	queue: string;

	/**
	 * The current status of the job.
	 */
	status: string;

	/**
	 * The error message if the job failed.
	 */
	error?: string;

	/**
	 * The number of retries attempted.
	 */
	retries: number;

	/**
	 * Timestamp when the job was created.
	 */
	createdAt: string;

	/**
	 * Timestamp when the job started.
	 */
	startedAt?: string;

	/**
	 * Timestamp when the job completed or failed.
	 */
	completedAt?: string;

	/**
	 * Timestamp when this status was last updated.
	 */
	updatedAt?: string;

	/**
	 * The original message ID in the Redis stream (internal use).
	 */
	messageId?: string;
}

/**
 * Indicates what mode a Transport is operating in.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export enum TransportMode {
	/**
	 * Listens for jobs/events from the transport (e.g., worker).
	 */
	CONSUMER = 'consumer',

	/**
	 * Actively pushes jobs/events to the transport (e.g., dispatcher).
	 */
	PRODUCER = 'producer'
}

/**
 * Message specific to job status updates.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type TransportJobUpdateMessage = {
	/**
	 * The type of message.
	 */
	type: 'job:update';

	/**
	 * The ID of the job.
	 */
	jobId: string;

	/**
	 * The ID of the dispatch.
	 */
	dispatchId: string;

	/**
	 * The name of the queue the job belongs to.
	 */
	queue: string;

	/**
	 * The current status of the job.
	 */
	status: string;

	/**
	 * Updates to the job status fields.
	 */
	updates: Partial<JobStatusInfo>;

	/**
	 * Whether to create a new entry if the job doesn't exist.
	 */
	createIfNotExist?: boolean;
};

/**
 * Interface for any transport layer that delivers job events between queue and worker.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export interface Transport {
	/**
	 * Starts the transport.
	 *
	 * This method should initialize the transport and mark it as ready to receive messages.
	 */
	start(): Promise<void> | void;

	/**
	 * Stops the transport.
	 *
	 * This method should stop the transport and mark it as stopped.
	 */
	stop(): Promise<void> | void;

	/**
	 * Sends a message over the transport.
	 *
	 * @param message The message to send.
	 * @returns A promise that resolves when the message has been sent.
	 */
	send(message: TransportEvent): Promise<void> | void;

	/**
	 * Registers a callback for receiving messages from the transport.
	 *
	 * @param handler The handler function to call when a message is received.
	 */
	onMessage(handler: (message: TransportEvent) => void | Promise<void>): void;

	/**
	 * Gets the current status of a job.
	 *
	 * @param jobId The ID of the job to get the status for.
	 * @param dispatchId The ID generated for the dispatch of the job.
	 * @param queueName The name of the queue the job belongs to.
	 * @returns A promise that resolves with the current job status.
	 */
	getJobStatus(jobId: string, dispatchId: string, queueName: string): Promise<JobStatusInfo>;

	/**
	 * Registers a worker with the transport.
	 *
	 * @param workerId The ID of the worker.
	 * @param queues The queues the worker handles.
	 * @returns A promise that resolves when the worker is registered.
	 */
	registerWorker(workerId: string, queues: string[]): Promise<void>;

	/**
	 * Unregisters a worker from the transport.
	 *
	 * @param workerId The ID of the worker to unregister.
	 * @returns A promise that resolves when the worker is unregistered.
	 */
	unregisterWorker(workerId: string): Promise<void>;

	/**
	 * Updates a job status directly without creating a new message.
	 *
	 * @param jobId The ID of the job to update.
	 * @param queueName The name of the queue the job belongs to.
	 * @param updates The status updates to apply.
	 * @returns A promise that resolves when the job is updated.
	 */
	updateJobStatus(
		jobId: string,
		dispatchId: string,
		queueName: string,
		updates: Partial<JobStatusInfo>
	): Promise<void>;
}

/**
 * Type signature for a transport constructor.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type TransportClass<T extends Transport = Transport> = {
	/**
	 * Creates a new transport instance.
	 *
	 * @param mode The mode of the transport (consumer or producer).
	 * @param options The options to pass to the transport.
	 */
	new (mode: TransportMode, options?: Record<string, any>): T;
};
