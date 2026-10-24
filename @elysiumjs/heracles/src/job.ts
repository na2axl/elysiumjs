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

import 'reflect-metadata';

import type { Class } from 'type-fest';

import { InteractsWithConsole } from '@elysiumjs/core';
import { assign, uid } from 'radash';

import { Symbols } from './utils';

/**
 * Defines how a job should behave when multiple instances with the same ID are dispatched.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export enum JobOverlapBehavior {
	/**
	 * Allow jobs with the same ID to execute concurrently.
	 */
	ALLOW_OVERLAP = 'allow_overlap',

	/**
	 * Only allow one job with a given ID to execute at a time.
	 * Additional jobs with the same ID will be queued and executed in sequence.
	 */
	NO_OVERLAP = 'no_overlap'
}

/**
 * Represents job metadata when registered.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export interface JobMetadata {
	/**
	 * The service name of the job in the container.
	 */
	name: string;

	/**
	 * The name of the queue the job is assigned to.
	 */
	queue: string;

	/**
	 * Defines how the job handles overlap with other instances of the same job ID.
	 */
	overlapBehavior: JobOverlapBehavior;

	/**
	 * When using NO_OVERLAP behavior, specifies the delay in milliseconds
	 * between sequential executions of jobs with the same ID.
	 */
	overlapDelay: number;

	/**
	 * Priority of this job (lower number = higher priority).
	 */
	priority: number;

	/**
	 * The maximum number of retries for this job type.
	 * This overrides queue-level retry settings.
	 * @default undefined - Uses queue setting
	 */
	maxRetries?: number;

	/**
	 * The delay between retries in milliseconds.
	 * This overrides queue-level retry delay settings.
	 * @default undefined - Uses queue setting
	 */
	retryDelay?: number;
}

/**
 * Properties required when declaring a job using the `@Job.register()` decorator.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type JobProps = {
	/**
	 * The name of the job.
	 */
	name?: string;

	/**
	 * The queue on which the job should be processed.
	 */
	queue?: string;

	/**
	 * Priority of this job (lower number = higher priority).
	 * @default 0
	 */
	priority?: number;

	/**
	 * The maximum number of retries for this job type.
	 * This overrides queue-level retry settings.
	 * @default undefined - Uses queue setting
	 */
	maxRetries?: number;

	/**
	 * The delay between retries in milliseconds.
	 * This overrides queue-level retry delay settings.
	 * @default undefined - Uses queue setting
	 */
	retryDelay?: number;

	/**
	 * Defines how the job handles overlap with other instances of the same job ID.
	 * @default JobOverlapBehavior.ALLOW_OVERLAP
	 */
	overlapBehavior?: JobOverlapBehavior;

	/**
	 * When using NO_OVERLAP behavior, specifies the delay in milliseconds
	 * between sequential executions of jobs with the same ID.
	 * @default 0
	 */
	overlapDelay?: number;
};

/**
 * Type for any job classes.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type JobClass<T extends Job = Job, TClass extends Class<T> = Class<T>> = {
	/**
	 * Description of the job.
	 */
	readonly description: string;

	/**
	 * Generates the ID for instances of this Job.
	 */
	generateJobId(...args: ConstructorParameters<TClass>): string;

	new (...args: ConstructorParameters<TClass>): T;
};

/**
 * Base class for background jobs.
 *
 * Jobs are classes that can be executed in the background. They provide
 * an abstract execute method that serves as the entry point for the job.
 *
 * @author Axel Nana <axel.nana@workbud.com>
 */
export abstract class Job extends InteractsWithConsole {
	#startedAt?: Date;
	#completedAt?: Date;
	#status: JobStatus = JobStatus.PENDING;
	#err?: Error;
	#retries: number = 0;
	#queueName?: string;

	/**
	 * Marks a class as a job.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param options The decorator options.
	 */
	public static register(options: JobProps = {}) {
		return function (target: JobClass) {
			options = assign(
				{
					name: target.name,
					queue: 'default',
					overlapBehavior: JobOverlapBehavior.ALLOW_OVERLAP,
					overlapDelay: 0,
					priority: 0
				},
				options
			);

			const name = `elysium.heracles.job.${options.name}`;

			// Store metadata for queue assignment and configuration
			const metadata: JobMetadata = {
				name,
				queue: options.queue!,
				overlapBehavior: options.overlapBehavior!,
				overlapDelay: options.overlapDelay!,
				priority: options.priority!,
				maxRetries: options.maxRetries,
				retryDelay: options.retryDelay
			};

			Reflect.defineMetadata(Symbols.job, metadata, target);
		};
	}

	/**
	 * Generate a random job ID.
	 * @param args Arguments passed to the constructor.
	 * @returns A random job ID.
	 */
	public static generateJobId(..._args: any[]): string {
		return `job_${Date.now()}_${uid(8)}`;
	}

	/**
	 * Description of the job.
	 */
	public static readonly description: string = 'An Heracles job.';

	/**
	 * Unique identifier for the job.
	 */
	public readonly id: string;

	/**
	 * The dispatch ID for this job instance.
	 * This is unique for each dispatch of the job, even if the job ID is the same.
	 */
	public readonly dispatchId: string;

	/**
	 * The timestamp when the job was created.
	 */
	public readonly createdAt: Date;

	/**
	 * The timestamp when the job started execution.
	 */
	public get startedAt(): Date | undefined {
		return this.#startedAt;
	}

	/**
	 * The timestamp when the job completed execution.
	 */
	public get completedAt(): Date | undefined {
		return this.#completedAt;
	}

	/**
	 * The current status of the job.
	 */
	public get status(): JobStatus {
		return this.#status;
	}

	/**
	 * The error that occurred during job execution, if any.
	 */
	public get lastError(): Error | undefined {
		return this.#err;
	}

	/**
	 * The number of times this job has been retried.
	 */
	public get retries(): number {
		return this.#retries;
	}

	/**
	 * The name of the queue this job is assigned to.
	 */
	public get queueName(): string | undefined {
		return this.#queueName;
	}

	/**
	 * Set the queue for this job instance.
	 * @internal This should only be called by the queue implementation.
	 */
	public set queueName(value: string | undefined) {
		this.#queueName = value;
	}

	/**
	 * Increment the retry count for this job.
	 * @internal This should only be called by the worker implementation.
	 */
	public incrementRetries(): void {
		this.#retries++;
	}

	/**
	 * Creates a new job instance.
	 *
	 * @param id Optional job ID. If not provided, a random ID will be generated.
	 */
	constructor(id?: string, dispatchId?: string) {
		super();
		this.id = id ?? (this.constructor as JobClass).generateJobId();
		this.dispatchId = dispatchId ?? `dispatch_${Date.now()}_${uid(8)}`;
		this.createdAt = new Date();
	}

	/**
	 * Run the job.
	 * This method handles the job lifecycle and calls the execute method.
	 * @returns A promise that resolves when the job completes (successfully or not).
	 */
	public async run(): Promise<void> {
		// Don't run cancelled jobs
		if (this.#status === JobStatus.CANCELLED) {
			return;
		}

		try {
			this.#status = JobStatus.RUNNING as JobStatus;
			this.#startedAt = new Date();

			const queueInfo = this.#queueName ? ` in queue '${this.#queueName}'` : '';
			this.debug(`Job ${this.id}${queueInfo} started at ${this.#startedAt.toISOString()}`);

			// Execute the job implementation
			await this.execute();

			if (this.#status === JobStatus.RUNNING) {
				this.#status = JobStatus.COMPLETED;
				this.#completedAt = new Date();
				this.debug(
					`Job ${this.id} completed successfully at ${this.#completedAt.toISOString()} after ${this.retries} retries`
				);
			}
		} catch (err) {
			this.fail(err instanceof Error ? err : new Error(String(err)));
		}
	}

	/**
	 * Marks the job as failed.
	 * @param error The error that caused the job to fail.
	 */
	public fail(error: Error): void {
		this.#err = error;

		if (this.#status !== JobStatus.CANCELLED) {
			this.#status = JobStatus.FAILED;
			this.#completedAt = new Date();
			this.error(
				`Job ${this.id} failed at ${this.#completedAt.toISOString()} after ${this.retries} retries: ${this.#err.message}`
			);
			this.trace(this.#err);
		}
	}

	/**
	 * Cancels the job.
	 * @returns True if the job was cancelled, false if it was already in a terminal state.
	 */
	public cancel(): boolean {
		// Only cancel jobs that are not already in a terminal state
		if (this.#status === JobStatus.COMPLETED || this.#status === JobStatus.FAILED) {
			return false;
		}

		const wasRunning = this.#status === JobStatus.RUNNING;
		this.#status = JobStatus.CANCELLED;

		if (wasRunning) {
			this.#completedAt = new Date();
		}

		this.info(`Job ${this.id} was cancelled${wasRunning ? ` while running` : ` before execution`}`);
		return true;
	}

	/**
	 * The main execution method for the job.
	 * This must be implemented by all job classes.
	 */
	protected abstract execute(): Promise<void>;
}

/**
 * Wraps a Job class to assign a specific ID to all instances.
 * @author Axel Nana <axel.nana@workbud.com>
 * @internal
 * @param J The Job class.
 * @param id The ID to assign to the job.
 * @returns A Job class which creates job instances with the specified ID.
 */
export const WithId = <T extends Job, TClass extends Class<T> = Class<T>>(
	J: TClass,
	id: string,
	dispatchId: string
): TClass => {
	// @ts-expect-error Mixin class typing
	return class extends J {
		constructor(...args: ConstructorParameters<TClass>) {
			super(...args);
			// @ts-expect-error Readonly field
			this.id = id;
			// @ts-expect-error Readonly field
			this.dispatchId = dispatchId;
		}
	};
};

/**
 * Possible statuses for a job.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export enum JobStatus {
	/**
	 * The job is in pending state; queued to run, but not started.
	 */
	PENDING = 'pending',

	/**
	 * The job is currently running.
	 */
	RUNNING = 'running',

	/**
	 * The job has completed successfully.
	 */
	COMPLETED = 'completed',

	/**
	 * The job has failed to complete successfully. No retries left.
	 */
	FAILED = 'failed',

	/**
	 * The job was cancelled and won't be retried or completed.
	 */
	CANCELLED = 'cancelled',

	/**
	 * The job is scheduled to be retried after a failure.
	 */
	SCHEDULED_FOR_RETRY = 'scheduled_for_retry'
}
