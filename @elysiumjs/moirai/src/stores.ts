// Copyright (c) 2026-present Workbud Technologies Inc. All rights reserved.
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

import { IdempotencyConflictError } from './errors';

/**
 * What an idempotency store keeps of a command call: its response, replayed when the key comes
 * back with the same request.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export interface IdempotencyRecord {
	key: string;
	command: string;
	/** The fingerprint of the input (see `requestHash`). */
	requestHash: string;
	/** The JSON-safe response of the command. */
	response: unknown;
	createdAt: Date;
}

/**
 * Where idempotent commands keep their responses. `put` runs in the command's unit of work, and
 * throws {@link IdempotencyConflictError} when another call stored the key first.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export interface IdempotencyStore {
	get(key: string): Promise<IdempotencyRecord | undefined>;
	put(record: IdempotencyRecord): Promise<void>;
}

/**
 * Serializes the commands that share a key (`serializeBy`): `lock` waits for the other holders,
 * and the lock lasts until the unit of work ends, or until the returned release runs.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export interface CommandLock {
	lock(key: string): Promise<(() => void) | void>;
}

/**
 * A side effect a command asks for. It is written to the outbox in the command's unit of work,
 * so it happens if and only if the command commits.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export interface OutboxEffect {
	/** The kind, which picks the `@Moirai.effect()` handler. */
	kind: string;
	/** The JSON-safe payload given to the handler. */
	payload: unknown;
	/** When the effect may run. Defaults to now. */
	availableAt?: Date;
}

/**
 * A row of the outbox.
 * @author Axel Nana <axel.nana@workbud.com>
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
 * @author Axel Nana <axel.nana@workbud.com>
 */
export interface OutboxClaimFilter {
	kinds?: readonly string[];
	ids?: readonly string[];
}

/**
 * Where the outbox rows live. `claimDue` returns the rows that are neither dispatched nor dead and
 * whose `availableAt` has passed, oldest first, and keeps other relays off them until the claim
 * ends (`FOR UPDATE SKIP LOCKED` on Postgres).
 * @author Axel Nana <axel.nana@workbud.com>
 */
export interface OutboxStore {
	insert(rows: readonly OutboxRow[]): Promise<void>;
	claimDue(now: Date, limit: number, filter?: OutboxClaimFilter): Promise<readonly OutboxRow[]>;
	markDispatched(id: string, dispatchedAt: Date): Promise<void>;
	markFailed(
		id: string,
		update: { attempts: number; lastError: string; availableAt: Date }
	): Promise<void>;
	markDead(
		id: string,
		update: { attempts: number; lastError: string; deadAt: Date }
	): Promise<void>;
}

/**
 * Where consumers remember the messages they processed. `record` answers `true` when the pair of
 * the message and the consumer is new.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export interface InboxStore {
	record(messageId: string, consumer: string): Promise<boolean>;
}

/**
 * Keeps idempotency records in memory, for tests and single-process apps.
 * @author Axel Nana <axel.nana@workbud.com>
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
 * Serializes commands in the process, one holder per key at a time.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class MemoryCommandLock implements CommandLock {
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
 * Keeps outbox rows in memory, for tests and single-process apps. Claims last until the row is
 * marked.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class MemoryOutboxStore implements OutboxStore {
	readonly #rows = new Map<string, OutboxRow>();
	readonly #claimed = new Set<string>();

	/** Every row, for assertions. */
	public get rows(): OutboxRow[] {
		return [...this.#rows.values()].map((row) => ({ ...row }));
	}

	public async insert(rows: readonly OutboxRow[]): Promise<void> {
		for (const row of rows) this.#rows.set(row.id, { ...row });
	}

	public async claimDue(
		now: Date,
		limit: number,
		filter: OutboxClaimFilter = {}
	): Promise<readonly OutboxRow[]> {
		if (filter.kinds?.length === 0 || filter.ids?.length === 0) return [];
		const due = [...this.#rows.values()]
			.filter(
				(row) =>
					row.dispatchedAt === null &&
					row.deadAt === null &&
					row.availableAt.getTime() <= now.getTime() &&
					!this.#claimed.has(row.id) &&
					(!filter.kinds || filter.kinds.includes(row.kind)) &&
					(!filter.ids || filter.ids.includes(row.id))
			)
			.sort((a, b) => a.availableAt.getTime() - b.availableAt.getTime())
			.slice(0, limit);
		for (const row of due) this.#claimed.add(row.id);
		return due.map((row) => ({ ...row }));
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

	#update(id: string, update: Partial<OutboxRow>): void {
		const row = this.#rows.get(id);
		if (row) this.#rows.set(id, { ...row, ...update });
		this.#claimed.delete(id);
	}
}

/**
 * Keeps inbox records in memory, for tests and single-process apps.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class MemoryInboxStore implements InboxStore {
	readonly #seen = new Set<string>();

	public async record(messageId: string, consumer: string): Promise<boolean> {
		const key = `${consumer}\u0000${messageId}`;
		if (this.#seen.has(key)) return false;
		this.#seen.add(key);
		return true;
	}
}
