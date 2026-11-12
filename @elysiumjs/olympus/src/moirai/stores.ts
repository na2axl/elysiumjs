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

import { UnitOfWork } from '../mnemosyne/index';

import { ConcurrencyConflictError, IdempotencyConflictError } from './errors';

/**
 * What an idempotency store keeps of an action call: its response, replayed when the key comes
 * back with the same request.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export interface IdempotencyRecord {
	key: string;
	action: string;
	/** The fingerprint of the input (see `requestHash`). */
	requestHash: string;
	/** The JSON-safe response of the action. */
	response: unknown;
	createdAt: Date;
}

/**
 * Where idempotent actions keep their responses. `put` runs in the action's unit of work, and
 * throws {@link IdempotencyConflictError} when another call stored the key first.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export interface IdempotencyStore {
	get(key: string): Promise<IdempotencyRecord | undefined>;
	put(record: IdempotencyRecord): Promise<void>;
}

/**
 * Serializes the actions that share a key (`serializeBy`): `lock` waits for the other holders,
 * and the lock lasts until the unit of work ends, or until the returned release runs.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export interface ActionLock {
	lock(key: string): Promise<(() => void) | void>;
}

/**
 * A side effect an action asks for. It is written to the outbox in the action's unit of work,
 * so it happens if and only if the action commits.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export interface OutboxEffect {
	/** The kind, which picks the `@Outbox.handle()` handler. */
	kind: string;
	/** The JSON-safe payload given to the handler. */
	payload: unknown;
	/** When the effect may run. Defaults to now. */
	availableAt?: Date;
}

/**
 * A row of the outbox.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export interface OutboxRow {
	id: string;
	kind: string;
	payload: unknown;
	createdAt: Date;
	availableAt: Date;
	attempts: number;
	lastError: string | null;
	dispatchedAt: Date | null;
	deadAt: Date | null;
}

/**
 * Narrows the rows a relay claims. Both fields must match when both are set; an empty list
 * matches nothing.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export interface OutboxClaimFilter {
	kinds?: readonly string[];
	ids?: readonly string[];
}

/**
 * Claims due outbox rows for one relay.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export interface OutboxClaim extends OutboxClaimFilter {
	now: Date;
	/** The claimed rows become due again at this date, when the relay dies before marking them. */
	leaseUntil: Date;
	limit: number;
}

/**
 * Where the outbox rows live. `claimDue` takes the rows that are neither dispatched nor dead and
 * whose `availableAt` has passed, oldest first, and moves their `availableAt` to `leaseUntil` in
 * the same statement, so that other relays leave them alone while this one handles them. Each
 * row is then handled and marked in a transaction of its own.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export interface OutboxStore {
	insert(rows: readonly OutboxRow[]): Promise<void>;
	claimDue(claim: OutboxClaim): Promise<readonly OutboxRow[]>;
	markDispatched(id: string, dispatchedAt: Date): Promise<void>;
	markFailed(
		id: string,
		update: { attempts: number; lastError: string; availableAt: Date }
	): Promise<void>;
	markDead(
		id: string,
		update: { attempts: number; lastError: string; deadAt: Date }
	): Promise<void>;
	/**
	 * Replaces the payload of a row, such as to drop a secret once it was sent. Called in the unit
	 * of work that marks the row dispatched. Optional: a store without it refuses
	 * `context.replacePayload()` in a handler.
	 */
	replacePayload?(id: string, payload: unknown): Promise<void>;
}

/**
 * Where consumers remember the messages they processed. `record` answers `true` when the pair of
 * the message and the consumer is new.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export interface InboxStore {
	record(messageId: string, consumer: string): Promise<boolean>;
}

/**
 * Keeps idempotency records in memory, for tests and single-process apps.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class MemoryIdempotencyStore implements IdempotencyStore {
	readonly #records = new Map<string, IdempotencyRecord>();

	public async get(key: string): Promise<IdempotencyRecord | undefined> {
		const record = this.#records.get(key);
		return record ? structuredClone(record) : undefined;
	}

	public async put(record: IdempotencyRecord): Promise<void> {
		if (this.#records.has(record.key)) throw new IdempotencyConflictError(record.key);
		this.#records.set(record.key, structuredClone(record));
	}
}

/**
 * Serializes actions in the process, one holder per key at a time.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class MemoryActionLock implements ActionLock {
	readonly #tails = new Map<string, Promise<void>>();

	public async lock(key: string): Promise<() => void> {
		const previous = this.#tails.get(key) ?? Promise.resolve();
		let release!: () => void;
		const current = new Promise<void>((resolve) => (release = resolve));
		const tail = previous.then(() => current);
		this.#tails.set(key, tail);
		await previous;
		return () => {
			release();
			if (this.#tails.get(key) === tail) this.#tails.delete(key);
		};
	}
}

/**
 * Keeps outbox rows in memory, for tests and single-process apps.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class MemoryOutboxStore implements OutboxStore {
	readonly #rows = new Map<string, OutboxRow>();

	/** Every row, for assertions. */
	public get rows(): OutboxRow[] {
		return [...this.#rows.values()].map((row) => ({ ...row }));
	}

	public async insert(rows: readonly OutboxRow[]): Promise<void> {
		for (const row of rows) this.#rows.set(row.id, { ...row });
		// Like a database table, the rows of a unit of work that rolls back are gone.
		UnitOfWork.afterRollback(() => {
			for (const row of rows) this.#rows.delete(row.id);
		});
	}

	public async claimDue(claim: OutboxClaim): Promise<readonly OutboxRow[]> {
		const { now, leaseUntil, limit, kinds, ids } = claim;
		if (kinds?.length === 0 || ids?.length === 0) return [];
		const due = [...this.#rows.values()]
			.filter(
				(row) =>
					row.dispatchedAt === null &&
					row.deadAt === null &&
					row.availableAt.getTime() <= now.getTime() &&
					(!kinds || kinds.includes(row.kind)) &&
					(!ids || ids.includes(row.id))
			)
			.sort((a, b) => a.availableAt.getTime() - b.availableAt.getTime())
			.slice(0, limit);
		for (const row of due) this.#rows.set(row.id, { ...row, availableAt: leaseUntil });
		return due.map((row) => ({ ...row, availableAt: leaseUntil }));
	}

	public async markDispatched(id: string, dispatchedAt: Date): Promise<void> {
		this.#update(id, { dispatchedAt });
	}

	public async markFailed(
		id: string,
		update: { attempts: number; lastError: string; availableAt: Date }
	): Promise<void> {
		this.#update(id, update);
	}

	public async markDead(
		id: string,
		update: { attempts: number; lastError: string; deadAt: Date }
	): Promise<void> {
		this.#update(id, update);
	}

	public async replacePayload(id: string, payload: unknown): Promise<void> {
		this.#update(id, { payload });
	}

	#update(id: string, update: Partial<OutboxRow>): void {
		const row = this.#rows.get(id);
		if (row) this.#rows.set(id, { ...row, ...update });
	}
}

/**
 * Keeps inbox records in memory, for tests and single-process apps.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class MemoryInboxStore implements InboxStore {
	readonly #seen = new Set<string>();

	public async record(messageId: string, consumer: string): Promise<boolean> {
		const key = `${consumer}\u0000${messageId}`;
		if (this.#seen.has(key)) return false;
		this.#seen.add(key);
		// Like a database table, the record of a unit of work that rolls back is gone.
		UnitOfWork.afterRollback(() => void this.#seen.delete(key));
		return true;
	}
}

/**
 * One event of a stream, as an {@link EventStore} keeps it.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export interface StoredEventRecord {
	/** The place of the event in the whole log, given by the store. Absent before it is appended. */
	position?: bigint;
	/** The id of the aggregate the stream belongs to. */
	aggregateId: string;
	/** The name of the aggregate class. */
	aggregateType: string;
	/** The version of the stream this event makes, from 1. */
	version: number;
	/** The name of the stored event class. */
	type: string;
	/** The version of the event's data. */
	schemaVersion: number;
	/** The JSON data of the event. */
	data: unknown;
	/** Who caused the event and why, such as the actor and the correlation id. */
	metadata: Record<string, unknown>;
	/** When the event happened. */
	occurredAt: Date;
}

/**
 * Keeps the event streams of aggregates.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export interface EventStore {
	/**
	 * The events of a stream, in version order.
	 * @param aggregateId The id of the aggregate.
	 * @param afterVersion Only the events after this version. Defaults to 0.
	 */
	load(aggregateId: string, afterVersion?: number): Promise<readonly StoredEventRecord[]>;
	/**
	 * Appends events to their streams, in the open unit of work. Rejects with a
	 * `ConcurrencyConflictError` when a stream already has an event at one of their versions, or
	 * another event than the one before the first appended.
	 * @param records The events, in version order.
	 */
	append(records: readonly StoredEventRecord[]): Promise<void>;
	/**
	 * Events of every stream, in the order of their position, such as to replay them.
	 * @param filter The types to read, the position to read after, and how many to read.
	 */
	readAll(filter: EventReadFilter): Promise<readonly StoredEventRecord[]>;
}

/**
 * Which events {@link EventStore.readAll} reads.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type EventReadFilter = {
	/** Only these types of events. */
	types?: readonly string[];
	/** Only the events after this position. */
	afterPosition?: bigint;
	/** How many events to read at most. */
	limit: number;
};

/**
 * Resets the read models of projections for their rebuild, and keeps the version each projection
 * was last built with.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export interface ProjectionStorage {
	/**
	 * Removes what the models hold, in the open unit of work. Readers keep seeing it until the
	 * unit of work commits, when the storage is transactional.
	 * @param models The models a projection writes.
	 */
	reset(models: readonly object[]): Promise<void>;
	/**
	 * The version a projection was last built with, if any.
	 * @param name The name of the projection.
	 */
	version(name: string): Promise<number | undefined>;
	/**
	 * Records the version a projection was built with.
	 * @param name The name of the projection.
	 * @param version Its version.
	 */
	built(name: string, version: number): Promise<void>;
}

/**
 * Keeps event streams in memory, for tests and single-process apps.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class MemoryEventStore implements EventStore {
	readonly #records: StoredEventRecord[] = [];
	#position = 0n;

	/** Every event, in the order they were appended, for assertions. */
	public get records(): StoredEventRecord[] {
		return this.#records.map((record) => ({ ...record }));
	}

	public async load(aggregateId: string, afterVersion = 0): Promise<readonly StoredEventRecord[]> {
		return this.#records
			.filter((record) => record.aggregateId === aggregateId && record.version > afterVersion)
			.sort((a, b) => a.version - b.version)
			.map((record) => ({ ...record }));
	}

	public async readAll(filter: EventReadFilter): Promise<readonly StoredEventRecord[]> {
		const { types, afterPosition = 0n, limit } = filter;
		return this.#records
			.filter(
				(record) => record.position! > afterPosition && (!types || types.includes(record.type))
			)
			.sort((a, b) => (a.position! < b.position! ? -1 : 1))
			.slice(0, limit)
			.map((record) => ({ ...record }));
	}

	public async append(records: readonly StoredEventRecord[]): Promise<void> {
		const first = new Map<string, StoredEventRecord>();
		for (const record of records) {
			const known = first.get(record.aggregateId);
			if (!known || record.version < known.version) first.set(record.aggregateId, record);
		}
		for (const [aggregateId, record] of first) {
			const head = this.#records
				.filter((stored) => stored.aggregateId === aggregateId)
				.reduce((max, stored) => Math.max(max, stored.version), 0);
			if (head !== record.version - 1)
				throw new ConcurrencyConflictError(record.aggregateType, aggregateId);
		}
		const appended = records.map((record) => ({ ...record, position: ++this.#position }));
		this.#records.push(...appended);
		// Like a database table, the events of a unit of work that rolls back are gone.
		UnitOfWork.afterRollback(() => {
			for (const record of appended) {
				const index = this.#records.indexOf(record);
				if (index >= 0) this.#records.splice(index, 1);
			}
		});
	}
}

/**
 * Keeps projection versions in memory, and resets models with a function, for tests and
 * single-process apps.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class MemoryProjectionStorage implements ProjectionStorage {
	readonly #versions = new Map<string, number>();

	/** @param onReset Removes what the models hold. */
	constructor(
		private readonly onReset: (models: readonly object[]) => void | Promise<void> = () => {}
	) {}

	public async reset(models: readonly object[]): Promise<void> {
		await this.onReset(models);
	}

	public async version(name: string): Promise<number | undefined> {
		return this.#versions.get(name);
	}

	public async built(name: string, version: number): Promise<void> {
		const before = this.#versions.get(name);
		this.#versions.set(name, version);
		UnitOfWork.afterRollback(() => {
			if (before === undefined) this.#versions.delete(name);
			else this.#versions.set(name, before);
		});
	}
}
