// Copyright (c) 2026-present Axel Nana <ax.lnana@outlook.com>. All rights reserved.
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
import type {
	JobStatusInfo,
	Transport,
	TransportEvent,
	TransportMode,
	TransportProcessMessage
} from '../transport';

import { ElysiumError, getLogger, ModuleContext } from '../../index';
import { openJobArgs } from '../encryption';
import { JobStatus, WithId } from '../job';
import { Queue } from '../queue';
import { JobRegistry } from '../registry';

/** A job the transport holds: waiting for its time, running, or done. */
type Entry = {
	info: JobStatusInfo;
	message: TransportProcessMessage;
	timer?: ReturnType<typeof setTimeout>;
	job?: Job;
	run?: Promise<void>;
};

/** The transports with jobs that are waiting or running, for {@link MemoryTransport.settled}. */
const busy = new Set<MemoryTransport>();

/** The longest a timer can wait: longer delays overflow and fire at once. */
const MAX_TIMER = 2 ** 31 - 1;

/** How many finished jobs each transport keeps for `getJobStatus`. */
const KEPT_FINISHED = 1000;

/**
 * Runs the jobs of a queue in the process that dispatches them, for development and tests: no
 * worker and no backend are needed. A job runs once its `scheduledFor` time comes, in the context
 * of the module that declares it. A failed job is retried after its `retryDelay` while its retries
 * stay within `maxRetries`, taken from the dispatch, then the job, then the queue options. The
 * last 1,000 finished jobs keep their status. Jobs are lost when the process stops.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @example
 * ```ts
 * HeraclesModule.with({ queues: { default: { transport: MemoryTransport } } });
 *
 * // In a test, once jobs are dispatched:
 * await MemoryTransport.settled();
 * ```
 */
export class MemoryTransport implements Transport {
	readonly #jobs = new Map<string, Entry>();
	#handler?: (message: TransportEvent) => void | Promise<void>;
	#running = true;

	constructor(_mode?: TransportMode, _options?: Record<string, any>) {}

	/**
	 * Waits until no job of any memory transport is waiting or running, retries included.
	 * @author Axel Nana <ax.lnana@outlook.com>
	 */
	public static async settled(): Promise<void> {
		while (busy.size > 0) {
			const runs = [...busy].flatMap((transport) => transport.#pending());
			if (runs.length === 0) await new Promise((resolve) => setTimeout(resolve, 1));
			else await Promise.allSettled(runs);
		}
	}

	public start(): void {
		if (this.#running) return;
		this.#running = true;
		// The jobs a stop left waiting run again.
		for (const entry of this.#jobs.values()) {
			if (entry.info.status === JobStatus.PENDING && !entry.timer && !entry.run) {
				const at = entry.message.options?.scheduledFor
					? Date.parse(entry.message.options.scheduledFor)
					: Date.now();
				this.#schedule(entry, at - Date.now());
			}
		}
	}

	public stop(): void {
		this.#running = false;
		for (const entry of this.#jobs.values()) {
			if (entry.timer) clearTimeout(entry.timer);
			entry.timer = undefined;
		}
		this.#update();
	}

	public send(message: TransportEvent): void {
		switch (message.type) {
			case 'job:process':
				return this.#enqueue(message);
			case 'job:cancel':
				return this.#cancel(
					this.#jobs.get(keyOf(message.queue, message.jobId, message.dispatchId))
				);
			case 'job:cancelAll':
				for (const entry of this.#jobs.values()) {
					if (entry.info.queue === message.queue) this.#cancel(entry);
				}
				return;
			default:
				return;
		}
	}

	public onMessage(handler: (message: TransportEvent) => void | Promise<void>): void {
		this.#handler = handler;
	}

	public async getJobStatus(
		jobId: string,
		dispatchId: string,
		queueName: string
	): Promise<JobStatusInfo> {
		const entry = this.#jobs.get(keyOf(queueName, jobId, dispatchId));
		if (!entry) throw new ElysiumError(`No job ${jobId} (${dispatchId}) in queue "${queueName}".`);
		return { ...entry.info };
	}

	public async registerWorker(): Promise<void> {}

	public async unregisterWorker(): Promise<void> {}

	public async updateJobStatus(
		jobId: string,
		dispatchId: string,
		queueName: string,
		updates: Partial<JobStatusInfo>
	): Promise<void> {
		const entry = this.#jobs.get(keyOf(queueName, jobId, dispatchId));
		if (entry) Object.assign(entry.info, updates, { updatedAt: new Date().toISOString() });
	}

	#enqueue(message: TransportProcessMessage): void {
		if (!this.#running) {
			getLogger().warn('A stopped memory transport dropped a job', { job: message.job });
			return;
		}
		const now = new Date().toISOString();
		const key = keyOf(message.queue, message.jobId, message.dispatchId);
		const entry: Entry = {
			message,
			info: {
				jobId: message.jobId,
				dispatchId: message.dispatchId,
				queue: message.queue,
				status: JobStatus.PENDING,
				retries: 0,
				createdAt: now,
				updatedAt: now
			}
		};
		this.#jobs.set(key, entry);
		const at = message.options?.scheduledFor
			? Date.parse(message.options.scheduledFor)
			: Date.now();
		this.#schedule(entry, at - Date.now());
	}

	#schedule(entry: Entry, delay: number): void {
		const wait = Math.max(0, delay);
		entry.timer = setTimeout(
			() => {
				entry.timer = undefined;
				// Past the longest timer, wait again for the rest.
				if (wait > MAX_TIMER) return this.#schedule(entry, wait - MAX_TIMER);
				entry.run = this.#run(entry)
					.catch((error: unknown) => {
						this.#settle(
							entry,
							JobStatus.FAILED,
							error instanceof Error ? error.message : String(error)
						);
						getLogger().error('A Heracles job could not run', { job: entry.message.job, error });
					})
					.finally(() => {
						entry.run = undefined;
						entry.job = undefined;
						this.#update();
					});
			},
			Math.min(wait, MAX_TIMER)
		);
		this.#update();
	}

	async #run(entry: Entry): Promise<void> {
		const { message, info } = entry;
		const registered = JobRegistry.get(message.job);
		if (!registered) {
			this.#settle(entry, JobStatus.FAILED, `No job is registered under "${message.job}".`);
			getLogger().error('No Heracles job is registered under this name', { job: message.job });
			return;
		}

		let args: unknown[];
		try {
			args = await openJobArgs(registered.jobClass, message.job, message.args);
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			this.#settle(entry, JobStatus.FAILED, reason);
			getLogger().error('The arguments of a Heracles job could not be read', {
				job: message.job,
				error: reason
			});
			return;
		}

		const job = ModuleContext.run(
			registered.module,
			() => new (WithId(registered.jobClass, message.jobId, message.dispatchId))(...args)
		);
		for (let i = 0; i < info.retries; i++) job.incrementRetries();
		job.queueName = message.queue;
		entry.job = job;
		Object.assign(info, { status: JobStatus.RUNNING, startedAt: new Date().toISOString() });
		await ModuleContext.run(registered.module, () => job.run());

		if (job.status !== JobStatus.FAILED) {
			this.#settle(entry, job.status, undefined);
			return;
		}

		const queue = Queue.exists(message.queue) ? Queue.get(message.queue).getOptions() : undefined;
		const maxRetries = Number(message.options?.maxRetries ?? queue?.maxRetries ?? 0);
		if (info.retries < maxRetries && this.#running) {
			info.retries++;
			Object.assign(info, { status: JobStatus.PENDING, error: job.lastError?.message });
			this.#schedule(entry, Number(message.options?.retryDelay ?? queue?.retryDelay ?? 0));
			return;
		}
		this.#settle(entry, JobStatus.FAILED, job.lastError?.message);
	}

	#settle(entry: Entry, status: string, error: string | undefined): void {
		const now = new Date().toISOString();
		Object.assign(entry.info, { status, error, completedAt: now, updatedAt: now });
		this.#prune();
		void this.#handler?.({
			type: 'job:result',
			jobId: entry.info.jobId,
			dispatchId: entry.info.dispatchId,
			queue: entry.info.queue,
			status,
			error,
			completedAt: now
		});
	}

	#cancel(entry: Entry | undefined): void {
		if (!entry) return;
		if (entry.timer) {
			clearTimeout(entry.timer);
			entry.timer = undefined;
			this.#settle(entry, JobStatus.CANCELLED, undefined);
		} else if (entry.job) {
			entry.job.cancel();
		}
		this.#update();
	}

	/** Forgets the oldest finished jobs past {@link KEPT_FINISHED}. */
	#prune(): void {
		let finished = 0;
		for (const entry of this.#jobs.values()) if (entry.info.completedAt) finished++;
		for (const [key, entry] of this.#jobs) {
			if (finished <= KEPT_FINISHED) break;
			if (entry.info.completedAt && !entry.timer && !entry.run) {
				this.#jobs.delete(key);
				finished--;
			}
		}
	}

	/** The runs in flight. */
	#pending(): Promise<void>[] {
		return [...this.#jobs.values()].flatMap((entry) => (entry.run ? [entry.run] : []));
	}

	#update(): void {
		const active = [...this.#jobs.values()].some((entry) => entry.timer || entry.run);
		if (active) busy.add(this);
		else busy.delete(this);
	}
}

const keyOf = (queue: string, jobId: string, dispatchId: string): string =>
	`${queue}\u0000${jobId}\u0000${dispatchId}`;
