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
	ActionLock,
	EventReadFilter,
	EventStore,
	IdempotencyRecord,
	IdempotencyStore,
	InboxStore,
	OutboxClaim,
	OutboxRow,
	OutboxStore,
	ProjectionStorage,
	StoredEventRecord
} from '@elysiumjs/moirai';

import { Clock } from '@elysiumjs/core';
import { Database, DrizzleTable } from '@elysiumjs/mnemosyne-drizzle';
import { ConcurrencyConflictError, IdempotencyConflictError } from '@elysiumjs/moirai';
import { and, asc, eq, gt, inArray, is, isNull, lt, lte, max, sql } from 'drizzle-orm';
import {
	bigserial,
	customType,
	index,
	integer,
	jsonb,
	PgColumn,
	pgSchema,
	PgTable,
	pgTable,
	primaryKey,
	text,
	timestamp,
	unique,
	uuid
} from 'drizzle-orm/pg-core';

const at = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/** Postgres `xid8`, the id of the transaction that wrote a row, read as its decimal string. */
const xid8 = customType<{ data: string }>({ dataType: () => 'xid8' });

/**
 * How `moiraiTables()` builds the tables.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type MoiraiTablesOptions = {
	/**
	 * Partitions `events` by range of `occurred_at` and `outbox` by range of `created_at`: their
	 * primary and unique keys then include that column, and `migration:generate` creates them
	 * with `PARTITION BY RANGE`. The partitions themselves are left to the app, for example in
	 * a migration hook.
	 */
	partitioned?: boolean;
};

/**
 * Builds the tables of the moirai stores: `idempotency_keys`, `outbox`, `inbox` and `events`, in a schema
 * when one is given (one set of tables per domain schema, for example). Export them from the
 * Drizzle schema so that `migration:generate` creates them.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @param schema The Postgres schema of the tables. Defaults to the search path.
 * @param options How the tables are built.
 */
export const moiraiTables = (schema?: string, options: MoiraiTablesOptions = {}) => {
	const table = (schema ? pgSchema(schema).table : pgTable) as typeof pgTable;
	const partitioned = options.partitioned ?? false;
	const partition = <T extends PgTable>(range: string, target: T): T =>
		partitioned ? DrizzleTable.define(DrizzleTable.partitioned({ range }))(target) : target;
	return {
		idempotencyKeys: table('idempotency_keys', {
			key: text('key').primaryKey(),
			action: text('action').notNull(),
			requestHash: text('request_hash').notNull(),
			response: jsonb('response'),
			createdAt: at('created_at').notNull().defaultNow()
		}),
		outbox: partition(
			'created_at',
			table(
				'outbox',
				{
					id: partitioned ? uuid('id').notNull() : uuid('id').primaryKey(),
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
					...(partitioned ? [primaryKey({ columns: [t.id, t.createdAt] })] : []),
					index('outbox_due_idx')
						.on(t.availableAt)
						.where(sql`${t.dispatchedAt} is null and ${t.deadAt} is null`)
				]
			)
		),
		inbox: table(
			'inbox',
			{
				messageId: text('message_id').notNull(),
				consumer: text('consumer').notNull(),
				recordedAt: at('recorded_at').notNull().defaultNow()
			},
			(t) => [primaryKey({ columns: [t.messageId, t.consumer] })]
		),
		events: partition(
			'occurred_at',
			table(
				'events',
				{
					position: partitioned
						? bigserial('position', { mode: 'bigint' }).notNull()
						: bigserial('position', { mode: 'bigint' }).primaryKey(),
					transactionId: xid8('transaction_id')
						.notNull()
						.default(sql`pg_current_xact_id()`),
					aggregateId: text('aggregate_id').notNull(),
					aggregateType: text('aggregate_type').notNull(),
					version: integer('version').notNull(),
					type: text('type').notNull(),
					schemaVersion: integer('schema_version').notNull().default(1),
					data: jsonb('data').notNull(),
					metadata: jsonb('metadata').notNull(),
					occurredAt: at('occurred_at').notNull()
				},
				(t) =>
					partitioned
						? [
								primaryKey({ columns: [t.position, t.occurredAt] }),
								unique('events_aggregate_version_uq').on(t.aggregateId, t.version, t.occurredAt)
							]
						: [unique('events_aggregate_version_uq').on(t.aggregateId, t.version)]
			)
		),
		projections: table('projections', {
			name: text('name').primaryKey(),
			version: integer('version').notNull(),
			builtAt: at('built_at').notNull().defaultNow()
		})
	};
};

export type MoiraiTables = ReturnType<typeof moiraiTables>;

/**
 * Where a Drizzle store works: its table, and the connection whose open transaction it joins.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type DrizzleStoreOptions<T> = { table: T; connection?: string };

/**
 * A table a store accepts: any Postgres table, in any schema, with the columns of the moirai table
 * `T` under the same property names, such as a table of a domain schema whose key also spans the
 * partition column.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type StoreTable<T extends PgTable> = PgTable & { [K in keyof T['_']['columns']]: PgColumn };

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
 * Keeps idempotency records in a Postgres table, in the action's transaction.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class DrizzleIdempotencyStore implements IdempotencyStore {
	constructor(
		private readonly options: DrizzleStoreOptions<StoreTable<MoiraiTables['idempotencyKeys']>>
	) {}

	/** The table, read through the columns of the moirai table, which it has. */
	private get table(): MoiraiTables['idempotencyKeys'] {
		return this.options.table as unknown as MoiraiTables['idempotencyKeys'];
	}

	public async get(key: string): Promise<IdempotencyRecord | undefined> {
		const t = this.table;
		const [row] = await Database.getConnection(this.options.connection)
			.select()
			.from(t)
			.where(eq(t.key, key))
			.limit(1);
		return row ? { ...row, response: row.response ?? null } : undefined;
	}

	public async put(record: IdempotencyRecord): Promise<void> {
		try {
			await Database.getConnection(this.options.connection).insert(this.table).values(record);
		} catch (error) {
			if (isUniqueViolation(error)) throw new IdempotencyConflictError(record.key);
			throw error;
		}
	}
}

/**
 * Keeps the outbox in a Postgres table. Claims lock the rows (`FOR UPDATE SKIP LOCKED`) until the
 * relay's transaction ends, so that concurrent relays share the work.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class DrizzleOutboxStore implements OutboxStore {
	constructor(private readonly options: DrizzleStoreOptions<StoreTable<MoiraiTables['outbox']>>) {}

	/** The table, read through the columns of the moirai table, which it has. */
	private get table(): MoiraiTables['outbox'] {
		return this.options.table as unknown as MoiraiTables['outbox'];
	}

	private get db() {
		return Database.getConnection(this.options.connection);
	}

	public async insert(rows: readonly OutboxRow[]): Promise<void> {
		if (rows.length === 0) return;
		await this.db.insert(this.table).values(rows.map((row) => ({ ...row })));
	}

	public async claimDue(claim: OutboxClaim): Promise<readonly OutboxRow[]> {
		const { now, leaseUntil, limit, kinds, ids } = claim;
		if (kinds?.length === 0 || ids?.length === 0) return [];
		const t = this.table;
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

	public async replacePayload(id: string, payload: unknown): Promise<void> {
		await this.#update(id, { payload });
	}

	async #update(id: string, values: Partial<OutboxRow>): Promise<void> {
		const t = this.table;
		await this.db.update(t).set(values).where(eq(t.id, id));
	}
}

/**
 * Keeps the inbox in a Postgres table: one row per message and consumer.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class DrizzleInboxStore implements InboxStore {
	constructor(private readonly options: DrizzleStoreOptions<StoreTable<MoiraiTables['inbox']>>) {}

	/** The table, read through the columns of the moirai table, which it has. */
	private get table(): MoiraiTables['inbox'] {
		return this.options.table as unknown as MoiraiTables['inbox'];
	}

	public async record(messageId: string, consumer: string): Promise<boolean> {
		const t = this.table;
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
		const t = this.table;
		const removed = await Database.getConnection(this.options.connection)
			.delete(t)
			.where(lt(t.recordedAt, cutoff))
			.returning({ messageId: t.messageId });
		return removed.length;
	}
}

/**
 * Serializes actions with a Postgres advisory lock taken in the action's transaction, and
 * released when it ends.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class PgAdvisoryLock implements ActionLock {
	constructor(private readonly options: { connection?: string } = {}) {}

	public async lock(key: string): Promise<void> {
		await Database.getConnection(this.options.connection).execute(
			sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`
		);
	}
}

const toRecord = (row: MoiraiTables['events']['$inferSelect']): StoredEventRecord => ({
	position: row.position,
	aggregateId: row.aggregateId,
	aggregateType: row.aggregateType,
	version: row.version,
	type: row.type,
	schemaVersion: row.schemaVersion,
	data: row.data,
	metadata: row.metadata as Record<string, unknown>,
	occurredAt: row.occurredAt
});

/**
 * Keeps event streams in a Postgres table, in the open transaction. An append locks each stream
 * it writes with an advisory lock held until the transaction ends, and checks that the stream
 * ends right before the first appended version, so a stale writer gets a
 * `ConcurrencyConflictError` even when the unique key of the table spans more columns, such as a
 * partition key. `position` and `transaction_id` are given by Postgres.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class DrizzleEventStore implements EventStore {
	constructor(private readonly options: DrizzleStoreOptions<StoreTable<MoiraiTables['events']>>) {}

	/** The table, read through the columns of the moirai table, which it has. */
	private get table(): MoiraiTables['events'] {
		return this.options.table as unknown as MoiraiTables['events'];
	}

	private get db() {
		return Database.getConnection(this.options.connection);
	}

	public async load(aggregateId: string, afterVersion = 0): Promise<readonly StoredEventRecord[]> {
		const t = this.table;
		const rows = await this.db
			.select()
			.from(t)
			.where(and(eq(t.aggregateId, aggregateId), gt(t.version, afterVersion)))
			.orderBy(asc(t.version));
		return rows.map(toRecord);
	}

	public async readAll(filter: EventReadFilter): Promise<readonly StoredEventRecord[]> {
		const { types, afterPosition, limit } = filter;
		if (types?.length === 0) return [];
		const t = this.table;
		const rows = await this.db
			.select()
			.from(t)
			.where(
				and(
					afterPosition === undefined ? undefined : gt(t.position, afterPosition),
					types ? inArray(t.type, [...types]) : undefined
				)
			)
			.orderBy(asc(t.position))
			.limit(limit);
		return rows.map(toRecord);
	}

	public async append(records: readonly StoredEventRecord[]): Promise<void> {
		if (records.length === 0) return;
		const t = this.table;
		const first = new Map<string, StoredEventRecord>();
		for (const record of records) {
			const known = first.get(record.aggregateId);
			if (!known || record.version < known.version) first.set(record.aggregateId, record);
		}
		try {
			// In a stable order, so that two appends to the same streams lock them alike.
			for (const [aggregateId, record] of [...first].sort(([a], [b]) => a.localeCompare(b))) {
				await this.db.execute(
					sql`select pg_advisory_xact_lock(hashtextextended(${aggregateId}::text, 0))`
				);
				const [head] = await this.db
					.select({ version: max(t.version) })
					.from(t)
					.where(eq(t.aggregateId, aggregateId));
				if ((head?.version ?? 0) !== record.version - 1)
					throw new ConcurrencyConflictError(record.aggregateType, aggregateId);
			}
			await this.db.insert(t).values(
				records.map((record) => ({
					aggregateId: record.aggregateId,
					aggregateType: record.aggregateType,
					version: record.version,
					type: record.type,
					schemaVersion: record.schemaVersion,
					data: record.data,
					metadata: record.metadata,
					occurredAt: record.occurredAt
				}))
			);
		} catch (error) {
			if (isUniqueViolation(error))
				throw new ConcurrencyConflictError(records[0]!.aggregateType, records[0]!.aggregateId);
			throw error;
		}
	}
}

/** The Drizzle table of a model, or of a Drizzle table itself. */
const tableOf = (model: object): PgTable => {
	if (is(model, PgTable)) return model;
	const table = (model as { table?: unknown }).table;
	if (table && is(table, PgTable)) return table;
	throw new TypeError(
		`${(model as { name?: string }).name ?? 'This model'} has no Drizzle table to reset. ` +
			'Pass a DrizzleModel or a Drizzle table in the models of the projection.'
	);
};

/**
 * Resets the tables of Drizzle models for projection rebuilds, and keeps the version each
 * projection was built with in a Postgres table. The reset deletes the rows in the open
 * transaction, so readers see them until the rebuild commits.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class DrizzleProjectionStorage implements ProjectionStorage {
	constructor(
		private readonly options: DrizzleStoreOptions<StoreTable<MoiraiTables['projections']>>
	) {}

	/** The table, read through the columns of the moirai table, which it has. */
	private get table(): MoiraiTables['projections'] {
		return this.options.table as unknown as MoiraiTables['projections'];
	}

	private get db() {
		return Database.getConnection(this.options.connection);
	}

	public async reset(models: readonly object[]): Promise<void> {
		for (const model of models) await this.db.delete(tableOf(model));
	}

	public async version(name: string): Promise<number | undefined> {
		const t = this.table;
		const [row] = await this.db
			.select({ version: t.version })
			.from(t)
			.where(eq(t.name, name))
			.limit(1);
		return row?.version;
	}

	public async built(name: string, version: number): Promise<void> {
		const t = this.table;
		const builtAt = Clock.now();
		await this.db
			.insert(t)
			.values({ name, version, builtAt })
			.onConflictDoUpdate({ target: t.name, set: { version, builtAt } });
	}
}
