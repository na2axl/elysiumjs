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

import type {
	WorkflowDriver,
	WorkflowDriverState,
	WorkflowHost,
	WorkflowSignalOutcome,
	WorkflowStartRequest
} from '../driver.js';
import type { WorkflowDuration } from '../duration.js';
import type { WorkflowStoreDriver } from './store.js';

import { Clock } from '../../clock.js';
import { ElysiumError } from '../../errors.js';
import { getLogger } from '../../logger.js';
import { Runtime } from '../../runtime.js';
import { Workflows } from '../driver.js';
import { toMilliseconds } from '../duration.js';
import { WorkflowDriverUnavailableError } from '../errors.js';
import { encodeValue, storeError } from '../serialize.js';
import { Replay } from './replay.js';

/**
 * The options of the `engine` driver.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type EngineDriverOptions = {
	/** Where instances are kept: a store, or a function that builds it when the module starts. */
	readonly store: WorkflowStoreDriver | (() => WorkflowStoreDriver);
	/**
	 * Whether this process runs instances. Defaults to `true`. Set `false` in processes that only
	 * start instances and send events, such as an HTTP server next to dedicated workers.
	 */
	readonly work?: boolean;
	/** How many instances this process runs at once. Defaults to 10. */
	readonly concurrency?: number;
	/** How often the worker looks for due instances. Defaults to 1 second. */
	readonly pollInterval?: WorkflowDuration;
	/**
	 * How long a worker holds an instance without news before another may take it over, when the
	 * worker died. Defaults to 15 minutes; a running worker extends it a few times per period.
	 */
	readonly lease?: WorkflowDuration;
	/** How long finished instances are kept. Defaults to 7 days. */
	readonly retention?: WorkflowDuration;
};

declare module '../../port.js' {
	interface PortDrivers {
		'workflow:engine': typeof EngineDriver;
	}
}

/** How often finished instances are purged. */
const PURGE_EVERY_MS = 3_600_000;

/** How many rounds `drain()` runs at most, so that a workflow that never settles cannot spin it forever. */
const MAX_DRAIN_ROUNDS = 10_000;

/**
 * Runs workflows in the process, over a {@link WorkflowStore}: on Bun, Node.js or Deno, in an
 * HTTP server or a worker process of its own. A worker in each process that sets `work` (the
 * default) runs the due instances; leases keep two processes from running the same instance, and
 * let another process take over from one that died.
 *
 * Starting an instance or sending it an event runs it at once in the same process; other
 * processes see it at their next poll.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @example
 * ```ts
 * OdysseusModule.with({
 * 	driver: () =>
 * 		Workflows.for('engine', {
 * 			store: () => WorkflowStore.for('drizzle', { connection: 'default' }),
 * 			concurrency: 20
 * 		})
 * });
 * ```
 */
@Workflows.driver('engine')
export class EngineDriver implements WorkflowDriver {
	readonly #options: EngineDriverOptions;
	readonly #active = new Map<string, Promise<void>>();
	#store: WorkflowStoreDriver | undefined;
	#host: WorkflowHost | undefined;
	#working = false;
	#timer: ReturnType<typeof setTimeout> | undefined;
	#ticking: Promise<void> | undefined;
	#again = false;
	#lastPurge = 0;

	constructor(options: EngineDriverOptions) {
		this.#options = options;
	}

	/** The store. */
	public get store(): WorkflowStoreDriver {
		if (!this.#store) {
			const { store } = this.#options;
			this.#store = typeof store === 'function' ? store() : store;
		}
		return this.#store;
	}

	public async open(host: WorkflowHost): Promise<void> {
		if (Runtime.find()?.name === 'workers') {
			throw new WorkflowDriverUnavailableError(
				'engine',
				'a Cloudflare Worker has no long-lived process; use the `cloudflare` driver of @elysiumjs/workers'
			);
		}
		this.#host = host;
		if (this.#options.work !== false) {
			this.#working = true;
			this.#schedule(0);
		}
	}

	public async close(): Promise<void> {
		this.#working = false;
		if (this.#timer) clearTimeout(this.#timer);
		this.#timer = undefined;
		while (this.#ticking || this.#active.size > 0) {
			await this.#ticking;
			await Promise.allSettled([...this.#active.values()]);
		}
	}

	public async start(requests: readonly WorkflowStartRequest[]): Promise<boolean[]> {
		const now = Clock.epochMs();
		const started: boolean[] = [];
		for (const request of requests) {
			started.push(
				await this.store.create({
					workflow: request.workflow,
					id: request.id,
					params: request.params,
					status: 'queued',
					wakeAt: now,
					createdAt: now,
					updatedAt: now
				})
			);
		}
		if (started.some(Boolean)) this.#schedule(0);
		return started;
	}

	public async signal(
		workflow: string,
		id: string,
		type: string,
		payload: unknown
	): Promise<WorkflowSignalOutcome> {
		const outcome = await this.store.addEvent(workflow, id, type, payload, Clock.epochMs());
		if (outcome === 'sent') this.#schedule(0);
		return outcome;
	}

	public async status(workflow: string, id: string): Promise<WorkflowDriverState | null> {
		const instance = await this.store.get(workflow, id);
		if (!instance) return null;
		return {
			status: instance.status,
			...(instance.output === undefined ? {} : { output: instance.output }),
			...(instance.error ? { error: instance.error } : {}),
			createdAt: new Date(instance.createdAt),
			updatedAt: new Date(instance.updatedAt)
		};
	}

	public terminate(workflow: string, id: string): Promise<boolean> {
		return this.store.terminate(workflow, id, Clock.epochMs());
	}

	/**
	 * Runs the instances due now, and those they make due, until none is left: for tests, with a
	 * frozen clock moved by `Clock.travel()`, and for scripts.
	 * @throws {ElysiumError} When the driver was not opened by `OdysseusModule`, or instances
	 * are still due after many rounds.
	 * @example
	 * ```ts
	 * await Odysseus.start(ShipOrder, { orderId: '42' }, { id: 'order-42' });
	 * await engine.drain();      // runs until the first sleep or wait
	 * Clock.travel(86_400_000);  // a day later
	 * await engine.drain();      // the sleep is over
	 * ```
	 */
	public async drain(): Promise<void> {
		if (!this.#host) {
			throw new ElysiumError('The engine driver is not open: start OdysseusModule first.');
		}
		for (let round = 0; round < MAX_DRAIN_ROUNDS; round++) {
			await Promise.allSettled([...this.#active.values()]);
			const due = await this.store.due(Clock.epochMs(), this.#concurrency, this.#workflows);
			if (due.length === 0) return;
			await Promise.allSettled(due.map(({ workflow, id }) => this.#run(workflow, id)));
		}
		throw new ElysiumError(`Workflow instances are still due after ${MAX_DRAIN_ROUNDS} rounds.`);
	}

	get #concurrency(): number {
		return Math.max(1, this.#options.concurrency ?? 10);
	}

	/** The names of the workflows this process runs. */
	get #workflows(): string[] {
		return this.#host?.workflows() ?? [];
	}

	/** Plans the next look for due instances, at once or after the poll interval. */
	#schedule(delay: number): void {
		if (!this.#working || !this.#host) return;
		if (this.#ticking) {
			if (delay === 0) this.#again = true;
			return;
		}
		if (this.#timer) {
			if (delay > 0) return;
			clearTimeout(this.#timer);
		}
		this.#timer = setTimeout(() => {
			this.#timer = undefined;
			this.#ticking = this.#tick().finally(() => {
				this.#ticking = undefined;
				const again = this.#again;
				this.#again = false;
				this.#schedule(again ? 0 : toMilliseconds(this.#options.pollInterval ?? 1_000));
			});
		}, delay);
	}

	/** Runs the due instances that fit, and purges old ones from time to time. */
	async #tick(): Promise<void> {
		try {
			const free = this.#concurrency - this.#active.size;
			if (free > 0) {
				const due = await this.store.due(
					Clock.epochMs(),
					free + this.#active.size,
					this.#workflows
				);
				for (const { workflow, id } of due) {
					if (!this.#working || this.#active.size >= this.#concurrency) break;
					void this.#run(workflow, id);
				}
			}
			const now = Clock.epochMs();
			if (this.#working && now - this.#lastPurge >= PURGE_EVERY_MS) {
				this.#lastPurge = now;
				await this.store.purge(now - toMilliseconds(this.#options.retention ?? '7 days'));
			}
		} catch (error) {
			getLogger().error('The workflow worker could not look for due instances', { error });
		}
	}

	/** Runs an instance, once at a time in this process. */
	#run(workflow: string, id: string): Promise<void> {
		const key = `${workflow}\u0000${id}`;
		const running = this.#active.get(key);
		if (running) return running;
		const run = this.#execute(workflow, id)
			.catch((error) =>
				getLogger().error('A workflow instance could not run', { workflow, id, error })
			)
			.finally(() => {
				this.#active.delete(key);
				if (this.#active.size < this.#concurrency) this.#schedule(0);
			});
		this.#active.set(key, run);
		return run;
	}

	/**
	 * Claims an instance and runs it until `run()` settles or every branch of it is suspended,
	 * then settles the instance: `completed` or `errored` when `run()` settled, whatever its
	 * suspended branches; `waiting` until the earliest suspended step otherwise.
	 */
	async #execute(workflow: string, id: string): Promise<void> {
		const host = this.#host;
		if (!host) return;
		const definition = host.definition(workflow);
		if (!definition) return;
		const store = this.store;
		const leaseMs = toMilliseconds(this.#options.lease ?? '15 minutes');
		const now = Clock.epochMs();
		// One owner per claim fences the writes of a run that lost its lease from a later run.
		const owner = crypto.randomUUID();
		const claimed = await store.claim(workflow, id, { owner, until: now + leaseMs }, now);
		if (!claimed) return;

		const replay = new Replay(claimed, store, { workflow, id }, owner, leaseMs, definition);
		const scope = {};
		type Result = { kind: 'done'; value: unknown } | { kind: 'error'; error: unknown };
		let result: Result | undefined;
		try {
			const running = host.run(workflow, claimed.instance.params, replay.step, scope).then(
				(value) => void (result = { kind: 'done', value }),
				(error) => void (result = { kind: 'error', error })
			);
			while (!result && !replay.lost) {
				if (replay.pending > 0 || !replay.isSuspended) {
					await Promise.race([running, replay.changed()]);
					continue;
				}
				// Every step left is suspended: let the other branches go on as far as they can.
				await new Promise((resolve) => setTimeout(resolve, 0));
				if (!result && !replay.lost && replay.pending === 0) break;
			}
			if (replay.lost) return;
			const settled = result as Result | undefined;
			let output: unknown;
			let failure: unknown;
			if (settled?.kind === 'done') {
				try {
					output = encodeValue(settled.value);
				} catch (error) {
					failure = new ElysiumError(
						`The workflow returned a value that cannot be kept: ${error instanceof Error ? error.message : String(error)}`
					);
				}
			}
			await store.settle(
				workflow,
				id,
				owner,
				!settled
					? { status: 'waiting', wakeAt: replay.wakeAt, seenSeq: replay.seenSeq }
					: settled.kind === 'done' && failure === undefined
						? { status: 'completed', wakeAt: null, output, seenSeq: replay.seenSeq }
						: {
								status: 'errored',
								wakeAt: null,
								error: storeError(settled.kind === 'error' ? settled.error : failure),
								seenSeq: replay.seenSeq
							},
				Clock.epochMs()
			);
		} finally {
			replay.close();
			await host.release(scope);
		}
	}
}
