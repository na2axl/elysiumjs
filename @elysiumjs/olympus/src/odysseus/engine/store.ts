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

import type { WorkflowStatus } from '../driver.js';
import type { StoredError } from '../serialize.js';

import { Port } from '../../port.js';

/**
 * An instance, as a store keeps it. Times are milliseconds since the epoch.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type StoredInstance = {
	/** The name of the workflow. */
	readonly workflow: string;
	/** The id of the instance, unique in its workflow. */
	readonly id: string;
	readonly params: unknown;
	readonly status: WorkflowStatus;
	/** The value `run()` returned, encoded. */
	readonly output?: unknown;
	readonly error?: StoredError | null;
	/** When a worker should run it next, or `null` when nothing will wake it. */
	readonly wakeAt: number | null;
	readonly createdAt: number;
	readonly updatedAt: number;
};

/**
 * A step, as a store keeps it.
 *
 * - `done`: finished, with its encoded value.
 * - `failed`: threw on every attempt; replays throw again.
 * - `retry`: threw, and runs again at `at`.
 * - `sleep`: sleeps until `until`.
 * - `wait`: waits for an event of `type` until `until`.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type StoredStep =
	| { readonly kind: 'done'; readonly value: unknown }
	| { readonly kind: 'failed'; readonly attempts: number; readonly reason: string }
	| { readonly kind: 'retry'; readonly attempts: number; readonly at: number }
	| { readonly kind: 'sleep'; readonly until: number }
	| { readonly kind: 'wait'; readonly type: string; readonly until: number };

/**
 * An event sent to an instance and not taken yet.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type StoredEvent = {
	/** Its order among the events of the instance, from 1. */
	readonly seq: number;
	readonly type: string;
	readonly payload: unknown;
	readonly at: number;
};

/**
 * Everything a worker needs to run an instance: the instance, its steps by key, and the events
 * it has not taken, oldest first.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type ClaimedInstance = {
	readonly instance: StoredInstance;
	readonly steps: Readonly<Record<string, StoredStep>>;
	readonly events: readonly StoredEvent[];
	/** The `seq` of the last event sent to the instance, taken or not; 0 when none was. */
	readonly lastSeq: number;
};

/**
 * A worker's hold on an instance: only one worker runs an instance at a time, and a hold that is
 * not extended ends at `until`, so that another worker takes over from a worker that died.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type WorkflowLease = { readonly owner: string; readonly until: number };

/**
 * How a run ends.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type InstanceSettlement = {
	readonly status: 'waiting' | 'completed' | 'errored';
	readonly wakeAt: number | null;
	readonly output?: unknown;
	readonly error?: StoredError;
	/** The last event the run saw: a later one wakes the instance at once. */
	readonly seenSeq: number;
};

/**
 * Keeps workflow instances for the `engine` driver: their params and status, the results of
 * their steps, the events sent to them, and when to run them next. `memory` is built in;
 * `@elysiumjs/drizzle` provides `drizzle` (PostgreSQL) and `@elysiumjs/redis` provides `redis`.
 *
 * Every write of a running instance names the worker's lease and is refused, answering `false`,
 * when another worker holds the instance.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export interface WorkflowStoreDriver {
	/** Creates an instance, `queued` and due now. Answers `false`, changing nothing, when its id is taken. */
	create(instance: StoredInstance): Promise<boolean>;

	/** An instance, or `null`. */
	get(workflow: string, id: string): Promise<StoredInstance | null>;

	/**
	 * The instances due at `now`, oldest wake first: `queued`, `waiting` or `running`, whose wake
	 * time has come and that no live lease holds.
	 * @param now The time.
	 * @param limit How many at most.
	 */
	due(now: number, limit: number): Promise<{ workflow: string; id: string }[]>;

	/**
	 * Takes an instance to run it, when it is due and no live lease holds it: marks it `running`
	 * under the lease and answers it with its steps and events.
	 * @returns The instance, or `null` when it is not due or another worker holds it.
	 */
	claim(
		workflow: string,
		id: string,
		lease: WorkflowLease,
		now: number
	): Promise<ClaimedInstance | null>;

	/** Gives a held instance more time. */
	extend(workflow: string, id: string, lease: WorkflowLease): Promise<boolean>;

	/**
	 * Keeps the result of a step, and takes the event of `seq` when given.
	 * @param key The key of the step.
	 */
	saveStep(
		workflow: string,
		id: string,
		owner: string,
		key: string,
		step: StoredStep,
		takes?: number
	): Promise<boolean>;

	/**
	 * Ends a run and lets go of the instance. When an event later than `seenSeq` came while it ran,
	 * the instance is due at once instead of at `wakeAt`.
	 */
	settle(
		workflow: string,
		id: string,
		owner: string,
		settlement: InstanceSettlement,
		now: number
	): Promise<boolean>;

	/** Keeps an event for an instance and makes it due at once. */
	addEvent(
		workflow: string,
		id: string,
		type: string,
		payload: unknown,
		now: number
	): Promise<'sent' | 'missing' | 'finished'>;

	/** Stops an instance that is not finished. */
	terminate(workflow: string, id: string, now: number): Promise<boolean>;

	/** Deletes the instances that finished before a time, and answers how many. */
	purge(before: number): Promise<number>;
}

declare module '../../port.js' {
	interface Ports {
		'workflow-store': WorkflowStoreDriver;
	}

	interface PortDrivers {
		'workflow-store:memory': typeof MemoryWorkflowStore;
	}
}

/**
 * The workflow store port, for the `engine` driver. `memory` is built in.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @example
 * ```ts
 * Workflows.for('engine', { store: WorkflowStore.for('memory') });
 * ```
 */
export class WorkflowStore extends Port('workflow-store') {}

/** The statuses whose instances may be claimed. */
export const CLAIMABLE: readonly WorkflowStatus[] = ['queued', 'waiting', 'running'];

/** The statuses of a finished instance. */
export const FINISHED: readonly WorkflowStatus[] = ['completed', 'errored', 'terminated'];

type Row = {
	instance: StoredInstance;
	lease: WorkflowLease | null;
	steps: Map<string, StoredStep>;
	events: StoredEvent[];
	seq: number;
};

/**
 * Keeps instances in the process, for tests and development: they are lost when it ends.
 * Values are copied as JSON on the way in and out, as a database would.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
@WorkflowStore.driver('memory')
export class MemoryWorkflowStore implements WorkflowStoreDriver {
	readonly #rows = new Map<string, Row>();

	constructor(_options?: Record<string, never>) {}

	public async create(instance: StoredInstance): Promise<boolean> {
		const key = keyOf(instance.workflow, instance.id);
		if (this.#rows.has(key)) return false;
		this.#rows.set(key, {
			instance: copy(instance),
			lease: null,
			steps: new Map(),
			events: [],
			seq: 0
		});
		return true;
	}

	public async get(workflow: string, id: string): Promise<StoredInstance | null> {
		const row = this.#rows.get(keyOf(workflow, id));
		return row ? copy(row.instance) : null;
	}

	public async due(now: number, limit: number): Promise<{ workflow: string; id: string }[]> {
		return [...this.#rows.values()]
			.filter((row) => isDue(row, now))
			.sort((a, b) => (a.instance.wakeAt ?? 0) - (b.instance.wakeAt ?? 0))
			.slice(0, limit)
			.map(({ instance }) => ({ workflow: instance.workflow, id: instance.id }));
	}

	public async claim(
		workflow: string,
		id: string,
		lease: WorkflowLease,
		now: number
	): Promise<ClaimedInstance | null> {
		const row = this.#rows.get(keyOf(workflow, id));
		if (!row || !isDue(row, now)) return null;
		row.lease = { ...lease };
		row.instance = { ...row.instance, status: 'running', updatedAt: now };
		return copy({
			instance: row.instance,
			steps: Object.fromEntries(row.steps),
			events: row.events,
			lastSeq: row.seq
		});
	}

	public async extend(workflow: string, id: string, lease: WorkflowLease): Promise<boolean> {
		const row = this.#held(workflow, id, lease.owner);
		if (!row) return false;
		row.lease = { ...lease };
		return true;
	}

	public async saveStep(
		workflow: string,
		id: string,
		owner: string,
		key: string,
		step: StoredStep,
		takes?: number
	): Promise<boolean> {
		const row = this.#held(workflow, id, owner);
		if (!row) return false;
		row.steps.set(key, copy(step));
		if (takes !== undefined) row.events = row.events.filter((event) => event.seq !== takes);
		return true;
	}

	public async settle(
		workflow: string,
		id: string,
		owner: string,
		settlement: InstanceSettlement,
		now: number
	): Promise<boolean> {
		const row = this.#held(workflow, id, owner);
		if (!row) return false;
		const woken = settlement.status === 'waiting' && row.seq > settlement.seenSeq;
		row.lease = null;
		row.instance = copy({
			...row.instance,
			status: settlement.status,
			wakeAt: woken ? now : settlement.wakeAt,
			output: settlement.output,
			error: settlement.error ?? null,
			updatedAt: now
		});
		return true;
	}

	public async addEvent(
		workflow: string,
		id: string,
		type: string,
		payload: unknown,
		now: number
	): Promise<'sent' | 'missing' | 'finished'> {
		const row = this.#rows.get(keyOf(workflow, id));
		if (!row) return 'missing';
		if (FINISHED.includes(row.instance.status)) return 'finished';
		row.seq += 1;
		row.events.push(copy({ seq: row.seq, type, payload, at: now }));
		const wakeAt = row.instance.wakeAt;
		row.instance = {
			...row.instance,
			wakeAt: wakeAt === null ? now : Math.min(wakeAt, now),
			updatedAt: now
		};
		return 'sent';
	}

	public async terminate(workflow: string, id: string, now: number): Promise<boolean> {
		const row = this.#rows.get(keyOf(workflow, id));
		if (!row || FINISHED.includes(row.instance.status)) return false;
		row.lease = null;
		row.instance = { ...row.instance, status: 'terminated', wakeAt: null, updatedAt: now };
		return true;
	}

	public async purge(before: number): Promise<number> {
		let purged = 0;
		for (const [key, row] of this.#rows) {
			if (FINISHED.includes(row.instance.status) && row.instance.updatedAt < before) {
				this.#rows.delete(key);
				purged += 1;
			}
		}
		return purged;
	}

	/** The row of an instance held by `owner`. */
	#held(workflow: string, id: string, owner: string): Row | undefined {
		const row = this.#rows.get(keyOf(workflow, id));
		return row?.lease?.owner === owner ? row : undefined;
	}
}

/** The key of an instance in a store. */
const keyOf = (workflow: string, id: string): string => `${workflow}\u0000${id}`;

/** Whether an instance may be claimed at `now`. */
const isDue = (row: Row, now: number): boolean =>
	CLAIMABLE.includes(row.instance.status) &&
	row.instance.wakeAt !== null &&
	row.instance.wakeAt <= now &&
	(row.lease === null || row.lease.until <= now);

/** A JSON copy, as a database gives back. */
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
