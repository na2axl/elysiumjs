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

import type {
	CommandLock,
	IdempotencyRecord,
	IdempotencyStore,
	InboxStore,
	OutboxClaim,
	OutboxRow,
	OutboxStore
} from '@elysiumjs/moirai';

import { Database } from '@elysiumjs/mnemosyne-drizzle';
import { IdempotencyConflictError } from '@elysiumjs/moirai';
import { and, asc, eq, inArray, isNull, lt, lte, sql } from 'drizzle-orm';
import {
	index,
	integer,
	jsonb,
	pgSchema,
	pgTable,
	primaryKey,
	text,
	timestamp,
	uuid
} from 'drizzle-orm/pg-core';

const at = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/**
 * Builds the tables of the moirai stores: `idempotency_keys`, `outbox` and `inbox`, in a schema
 * when one is given (one set of tables per domain schema, for example). Export them from the
 * Drizzle schema so that `migration:generate` creates them.
 * @author Axel Nana <axel.nana@workbud.com>
 * @param schema The Postgres schema of the tables. Defaults to the search path.
 */
export const moiraiTables = (schema?: string) => {
	const table = (schema ? pgSchema(schema).table : pgTable) as typeof pgTable;
	return {
		idempotencyKeys: table('idempotency_keys', {
			key: text('key').primaryKey(),
			command: text('command').notNull(),
			requestHash: text('request_hash').notNull(),
			response: jsonb('response'),
			createdAt: at('created_at').notNull().defaultNow()
		}),
		outbox: table(
			'outbox',
			{
				id: uuid('id').primaryKey(),
				kind: text('kind').notNull(),
				payload: jsonb('payload').notNull(),
				createdAt: at('created_at').notNull().defaultNow(),
				availableAt: at('available_at').notNull().defaultNow(),
				attempts: integer('attempts').notNull().default(0),
				lastError: text('last_error'),
				dispatchedAt: at('dispatched_at'),
				deadAt: at('dead_at')
			},
			(t) => [
				index('outbox_due_idx')
					.on(t.availableAt)
					.where(sql`${t.dispatchedAt} is null and ${t.deadAt} is null`)
			]
		),
		inbox: table(
			'inbox',
			{
				messageId: text('message_id').notNull(),
				consumer: text('consumer').notNull(),
				recordedAt: at('recorded_at').notNull().defaultNow()
			},
			(t) => [primaryKey({ columns: [t.messageId, t.consumer] })]
		)
	};
};

export type MoiraiTables = ReturnType<typeof moiraiTables>;

/**
 * Where a Drizzle store works: its table, and the connection whose open transaction it joins.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type DrizzleStoreOptions<T> = { table: T; connection?: string };

/** Whether an error is a Postgres unique violation, from any driver. */
const isUniqueViolation = (error: unknown): boolean => {
	for (
		let e = error as { code?: unknown; errno?: unknown; cause?: unknown } | undefined;
		e;
		e = e.cause as never
	) {
		// postgres.js and node-postgres keep the SQLSTATE in `code`, Bun's SQL driver in `errno`.
		if (e.code === '23505' || e.errno === '23505') return true;
		if (e.cause === e) break;
	}
	return false;
};

/**
 * Keeps idempotency records in a Postgres table, in the command's transaction.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class DrizzleIdempotencyStore implements IdempotencyStore {
	constructor(private readonly options: DrizzleStoreOptions<MoiraiTables['idempotencyKeys']>) {}

	public async get(key: string): Promise<IdempotencyRecord | undefined> {
		const t = this.options.table;
		const [row] = await Database.getConnection(this.options.connection)
			.select()
			.from(t)
			.where(eq(t.key, key))
			.limit(1);
		return row ? { ...row, response: row.response ?? null } : undefined;
	}

	public async put(record: IdempotencyRecord): Promise<void> {
		try {
			await Database.getConnection(this.options.connection)
				.insert(this.options.table)
				.values(record);
		} catch (error) {
			if (isUniqueViolation(error)) throw new IdempotencyConflictError(record.key);
			throw error;
		}
	}
}

/**
 * Keeps the outbox in a Postgres table. Claims lock the rows (`FOR UPDATE SKIP LOCKED`) until the
 * relay's transaction ends, so that concurrent relays share the work.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class DrizzleOutboxStore implements OutboxStore {
	constructor(private readonly options: DrizzleStoreOptions<MoiraiTables['outbox']>) {}

	private get db() {
		return Database.getConnection(this.options.connection);
	}

	public async insert(rows: readonly OutboxRow[]): Promise<void> {
		if (rows.length === 0) return;
		await this.db.insert(this.options.table).values(rows.map((row) => ({ ...row })));
	}

	public async claimDue(claim: OutboxClaim): Promise<readonly OutboxRow[]> {
		const { now, leaseUntil, limit, kinds, ids } = claim;
		if (kinds?.length === 0 || ids?.length === 0) return [];
		const t = this.options.table;
		const due = this.db
			.select({ id: t.id })
			.from(t)
			.where(
				and(
					isNull(t.dispatchedAt),
					isNull(t.deadAt),
					lte(t.availableAt, now),
					kinds ? inArray(t.kind, [...kinds]) : undefined,
					ids ? inArray(t.id, [...ids]) : undefined
				)
			)
			.orderBy(asc(t.availableAt))
			.limit(limit)
			.for('update', { skipLocked: true });
		const rows = await this.db
			.update(t)
			.set({ availableAt: leaseUntil })
			.where(inArray(t.id, due))
			.returning();
		// The ids are UUIDv7, so they sort in creation order.
		return rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
	}

	public async markDispatched(id: string, dispatchedAt: Date): Promise<void> {
		await this.#update(id, { dispatchedAt });
	}

	public async markFailed(
		id: string,
		update: { attempts: number; lastError: string; availableAt: Date }
	): Promise<void> {
		await this.#update(id, update);
	}

	public async markDead(
		id: string,
		update: { attempts: number; lastError: string; deadAt: Date }
	): Promise<void> {
		await this.#update(id, update);
	}

	async #update(id: string, values: Partial<OutboxRow>): Promise<void> {
		const t = this.options.table;
		await this.db.update(t).set(values).where(eq(t.id, id));
	}
}

/**
 * Keeps the inbox in a Postgres table: one row per message and consumer.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class DrizzleInboxStore implements InboxStore {
	constructor(private readonly options: DrizzleStoreOptions<MoiraiTables['inbox']>) {}

	public async record(messageId: string, consumer: string): Promise<boolean> {
		const t = this.options.table;
		const written = await Database.getConnection(this.options.connection)
			.insert(t)
			.values({ messageId, consumer })
			.onConflictDoNothing()
			.returning({ messageId: t.messageId });
		return written.length > 0;
	}

	/**
	 * Deletes the records older than a date, such as from a daily cron.
	 * @param cutoff The date before which records go.
	 * @returns The number of records deleted.
	 */
	public async pruneBefore(cutoff: Date): Promise<number> {
		const t = this.options.table;
		const removed = await Database.getConnection(this.options.connection)
			.delete(t)
			.where(lt(t.recordedAt, cutoff))
			.returning({ messageId: t.messageId });
		return removed.length;
	}
}

/**
 * Serializes commands with a Postgres advisory lock taken in the command's transaction, and
 * released when it ends.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class PgAdvisoryLock implements CommandLock {
	constructor(private readonly options: { connection?: string } = {}) {}

	public async lock(key: string): Promise<void> {
		await Database.getConnection(this.options.connection).execute(
			sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`
		);
	}
}
