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
	ClaimedInstance,
	InstanceSettlement,
	StoredError,
	StoredEvent,
	StoredInstance,
	StoredStep,
	WorkflowLease,
	WorkflowStatus,
	WorkflowStoreDriver
} from '@elysiumjs/olympus/odysseus';
import type { SQL } from 'drizzle-orm';
import type { BuiltPgTable } from './built-table.js';
import type { StoreTable } from './moirai.js';

import { CLAIMABLE, FINISHED_STATUSES, WorkflowStore } from '@elysiumjs/olympus/odysseus';
import { and, asc, eq, getTableColumns, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import {
	index,
	integer,
	jsonb,
	pgSchema,
	pgTable,
	primaryKey,
	text,
	timestamp
} from 'drizzle-orm/pg-core';

import { Database } from './database.js';

declare module '@elysiumjs/olympus' {
	interface PortDrivers {
		'workflow-store:drizzle': typeof DrizzleWorkflowStore;
	}
}

const at = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/** The columns of `workflow_instances`. */
const instanceColumns = () => ({
	workflow: text('workflow').notNull(),
	id: text('id').notNull(),
	params: jsonb('params'),
	status: text('status').$type<WorkflowStatus>().notNull(),
	output: jsonb('output'),
	error: jsonb('error').$type<StoredError>(),
	wakeAt: at('wake_at'),
	leaseOwner: text('lease_owner'),
	leaseUntil: at('lease_until'),
	seq: integer('seq').notNull().default(0),
	createdAt: at('created_at').notNull(),
	updatedAt: at('updated_at').notNull()
});

/** The columns of `workflow_steps`. */
const stepColumns = () => ({
	workflow: text('workflow').notNull(),
	id: text('id').notNull(),
	key: text('key').notNull(),
	step: jsonb('step').$type<StoredStep>().notNull()
});

/** The columns of `workflow_events`. */
const eventColumns = () => ({
	workflow: text('workflow').notNull(),
	id: text('id').notNull(),
	seq: integer('seq').notNull(),
	type: text('type').notNull(),
	payload: jsonb('payload'),
	at: at('at').notNull()
});

/**
 * The tables `workflowTables()` builds.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type WorkflowTables = {
	instances: BuiltPgTable<'workflow_instances', undefined, ReturnType<typeof instanceColumns>>;
	steps: BuiltPgTable<'workflow_steps', undefined, ReturnType<typeof stepColumns>>;
	events: BuiltPgTable<'workflow_events', undefined, ReturnType<typeof eventColumns>>;
};

/**
 * Builds the tables of the workflow store: `workflow_instances`, `workflow_steps` and
 * `workflow_events`, in a schema when one is given. Export them from the Drizzle schema so that
 * `migration:generate` creates them.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @param schema The Postgres schema of the tables. Defaults to the search path.
 * @example
 * ```ts
 * export const workflows = workflowTables();
 *
 * Workflows.for('engine', {
 * 	store: () => WorkflowStore.for('drizzle', { tables: workflows })
 * });
 * ```
 */
export const workflowTables = (schema?: string): WorkflowTables => {
	const table = (schema ? pgSchema(schema).table : pgTable) as typeof pgTable;
	return {
		instances: table('workflow_instances', instanceColumns(), (t) => [
			primaryKey({ columns: [t.workflow, t.id] }),
			index('workflow_instances_due_idx')
				.on(t.wakeAt)
				.where(sql`${t.status} in ('queued', 'waiting', 'running')`),
			index('workflow_instances_finished_idx')
				.on(t.updatedAt)
				.where(sql`${t.status} in ('completed', 'errored', 'terminated')`)
		]),
		steps: table('workflow_steps', stepColumns(), (t) => [
			primaryKey({ columns: [t.workflow, t.id, t.key] })
		]),
		events: table('workflow_events', eventColumns(), (t) => [
			primaryKey({ columns: [t.workflow, t.id, t.seq] })
		])
	};
};

/**
 * The options of the `drizzle` workflow store.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type DrizzleWorkflowStoreOptions = {
	/**
	 * The tables, built with `workflowTables()`, or any tables with their columns under the same
	 * property names.
	 */
	tables: {
		instances: StoreTable<WorkflowTables['instances']>;
		steps: StoreTable<WorkflowTables['steps']>;
		events: StoreTable<WorkflowTables['events']>;
	};
	/** The database connection. Defaults to `default`. */
	connection?: string;
	/** How many finished instances one purge deletes at most. Defaults to 1000. */
	purgeBatch?: number;
};

type InstanceRow = Omit<WorkflowTables['instances']['$inferSelect'], 'params' | 'output'> & {
	params: [unknown] | null;
	output: [unknown] | null;
};

/**
 * A JSON value to write: JSON `null` for `null`, SQL `NULL` for no value, so that both come back
 * as they were written.
 */
const jsonValue = (value: unknown) =>
	value === undefined ? null : sql`(${JSON.stringify(value)}::text)::jsonb`;

/**
 * A JSON column to read, wrapped in an array: `[value]` when it holds a value, JSON `null`
 * included, and `null` when it holds none.
 */
const kept = (column: unknown) =>
	sql<
		[unknown] | null
	>`case when ${column} is null then null else jsonb_build_array(${column}) end`;

/** A value read with {@link kept}. */
const unwrap = (value: [unknown] | null): unknown => (value === null ? undefined : value[0]);

/** The statuses an instance may be claimed in, inlined so that the partial index applies. */
const CLAIMABLE_SQL = sql.raw(`(${CLAIMABLE.map((status) => `'${status}'`).join(', ')})`);

/** The statuses of a finished instance, inlined so that the partial index applies. */
const FINISHED_SQL = sql.raw(`(${FINISHED_STATUSES.map((status) => `'${status}'`).join(', ')})`);

/** The time of a store, as a date of a row. */
const dateOf = (ms: number): Date => new Date(ms);

/** The time of a row, as the store answers it. */
const msOf = (date: Date | null): number | null => (date === null ? null : date.getTime());

/** An instance row, as the store answers it. */
const instanceOf = (row: InstanceRow): StoredInstance => ({
	workflow: row.workflow,
	id: row.id,
	params: unwrap(row.params),
	status: row.status,
	...(row.output === null ? {} : { output: unwrap(row.output) }),
	error: row.error ?? null,
	wakeAt: msOf(row.wakeAt),
	createdAt: row.createdAt.getTime(),
	updatedAt: row.updatedAt.getTime()
});

/**
 * Keeps workflow instances in Postgres, for the `engine` driver: every write is one statement
 * or one transaction, and a claim takes an instance with one conditional update, so that any
 * number of processes share the tables.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @example
 * ```ts
 * // schema.ts
 * export const workflows = workflowTables();
 *
 * // app.ts
 * OdysseusModule.with({
 * 	driver: () =>
 * 		Workflows.for('engine', {
 * 			store: () => WorkflowStore.for('drizzle', { tables: workflows })
 * 		})
 * });
 * ```
 */
@WorkflowStore.driver('drizzle')
export class DrizzleWorkflowStore implements WorkflowStoreDriver {
	constructor(private readonly options: DrizzleWorkflowStoreOptions) {}

	/** The tables, read through the columns of `workflowTables()`, which they have. */
	private get tables(): WorkflowTables {
		return this.options.tables as unknown as WorkflowTables;
	}

	/** The connection, joining the transaction of the caller: for starts, events and stops. */
	private get db() {
		return Database.getConnection(this.options.connection);
	}

	/** The connection outside any transaction of the caller: for the writes of the worker. */
	private get worker() {
		return Database.getBaseConnection(this.options.connection);
	}

	/** The columns of an instance, with its JSON values read with {@link kept}. */
	private get fields() {
		const t = this.tables.instances;
		return { ...getTableColumns(t), params: kept(t.params), output: kept(t.output) };
	}

	/** The row of an instance. */
	private instance(workflow: string, id: string): SQL {
		const t = this.tables.instances;
		return and(eq(t.workflow, workflow), eq(t.id, id))!;
	}

	/** The rows of an instance in the steps or events table. */
	private of(
		table: WorkflowTables['steps'] | WorkflowTables['events'],
		workflow: string,
		id: string
	) {
		return and(eq(table.workflow, workflow), eq(table.id, id))!;
	}

	/** The row of an instance held by `owner`. */
	private held(workflow: string, id: string, owner: string): SQL {
		return and(this.instance(workflow, id), eq(this.tables.instances.leaseOwner, owner))!;
	}

	/** Whether an instance may be claimed at `now`. */
	private dueAt(now: number): SQL {
		const t = this.tables.instances;
		return and(
			sql`${t.status} in ${CLAIMABLE_SQL}`,
			lte(t.wakeAt, dateOf(now)),
			or(isNull(t.leaseUntil), lte(t.leaseUntil, dateOf(now)))
		)!;
	}

	public async create(instance: StoredInstance): Promise<boolean> {
		const t = this.tables.instances;
		const created = await this.db
			.insert(t)
			.values({
				workflow: instance.workflow,
				id: instance.id,
				params: jsonValue(instance.params),
				status: instance.status,
				wakeAt: instance.wakeAt === null ? null : dateOf(instance.wakeAt),
				createdAt: dateOf(instance.createdAt),
				updatedAt: dateOf(instance.updatedAt)
			})
			.onConflictDoNothing()
			.returning({ id: t.id });
		return created.length > 0;
	}

	public async get(workflow: string, id: string): Promise<StoredInstance | null> {
		const [row] = await this.db
			.select(this.fields)
			.from(this.tables.instances)
			.where(this.instance(workflow, id));
		return row ? instanceOf(row) : null;
	}

	public async due(
		now: number,
		limit: number,
		workflows: readonly string[]
	): Promise<{ workflow: string; id: string }[]> {
		if (workflows.length === 0) return [];
		const t = this.tables.instances;
		return this.worker
			.select({ workflow: t.workflow, id: t.id })
			.from(t)
			.where(and(inArray(t.workflow, [...workflows]), this.dueAt(now)))
			.orderBy(asc(t.wakeAt))
			.limit(limit);
	}

	public async claim(
		workflow: string,
		id: string,
		lease: WorkflowLease,
		now: number
	): Promise<ClaimedInstance | null> {
		const { instances, steps, events } = this.tables;
		return this.worker.transaction(async (tx) => {
			const [row] = await tx
				.update(instances)
				.set({
					status: 'running',
					leaseOwner: lease.owner,
					leaseUntil: dateOf(lease.until),
					updatedAt: dateOf(now)
				})
				.where(and(this.instance(workflow, id), this.dueAt(now)))
				.returning(this.fields);
			if (!row) return null;
			const keptSteps = await tx
				.select({ key: steps.key, step: steps.step })
				.from(steps)
				.where(this.of(steps, workflow, id));
			const sent = await tx
				.select({
					seq: events.seq,
					type: events.type,
					payload: kept(events.payload),
					at: events.at
				})
				.from(events)
				.where(this.of(events, workflow, id))
				.orderBy(asc(events.seq));
			return {
				instance: instanceOf(row),
				steps: Object.fromEntries(keptSteps.map(({ key, step }) => [key, step])),
				events: sent.map((event): StoredEvent => {
					const payload = unwrap(event.payload);
					return {
						seq: event.seq,
						type: event.type,
						...(payload === undefined ? {} : { payload }),
						at: event.at.getTime()
					} as StoredEvent;
				}),
				lastSeq: row.seq
			};
		});
	}

	public async extend(workflow: string, id: string, lease: WorkflowLease): Promise<boolean> {
		const t = this.tables.instances;
		const extended = await this.worker
			.update(t)
			.set({ leaseUntil: dateOf(lease.until) })
			.where(this.held(workflow, id, lease.owner))
			.returning({ id: t.id });
		return extended.length > 0;
	}

	public async saveStep(
		workflow: string,
		id: string,
		owner: string,
		key: string,
		step: StoredStep,
		takes?: number
	): Promise<boolean> {
		const { instances, steps, events } = this.tables;
		return this.worker.transaction(async (tx) => {
			// Locks the row of the instance for the transaction, while the lease is checked.
			const [held] = await tx
				.select({ id: instances.id })
				.from(instances)
				.where(this.held(workflow, id, owner))
				.for('update');
			if (!held) return false;
			await tx
				.insert(steps)
				.values({ workflow, id, key, step })
				.onConflictDoUpdate({ target: [steps.workflow, steps.id, steps.key], set: { step } });
			if (takes !== undefined) {
				await tx.delete(events).where(and(this.of(events, workflow, id), eq(events.seq, takes)));
			}
			return true;
		});
	}

	public async settle(
		workflow: string,
		id: string,
		owner: string,
		settlement: InstanceSettlement,
		now: number
	): Promise<boolean> {
		const t = this.tables.instances;
		const wakeAt = settlement.wakeAt === null ? null : dateOf(settlement.wakeAt);
		const settled = await this.worker
			.update(t)
			.set({
				status: settlement.status,
				// An event that came while the instance ran wakes it at once.
				wakeAt:
					settlement.status === 'waiting'
						? sql`case when ${t.seq} > ${settlement.seenSeq} then ${dateOf(now)}::timestamptz else ${wakeAt}::timestamptz end`
						: wakeAt,
				output: jsonValue(settlement.output),
				error: settlement.error ?? null,
				leaseOwner: null,
				leaseUntil: null,
				updatedAt: dateOf(now)
			})
			.where(this.held(workflow, id, owner))
			.returning({ id: t.id });
		return settled.length > 0;
	}

	public async addEvent(
		workflow: string,
		id: string,
		type: string,
		payload: unknown,
		now: number
	): Promise<'sent' | 'missing' | 'finished'> {
		const { instances, events } = this.tables;
		return this.db.transaction(async (tx) => {
			const [row] = await tx
				.update(instances)
				.set({
					seq: sql`${instances.seq} + 1`,
					wakeAt: sql`least(coalesce(${instances.wakeAt}, ${dateOf(now)}::timestamptz), ${dateOf(now)}::timestamptz)`,
					updatedAt: dateOf(now)
				})
				.where(and(this.instance(workflow, id), sql`${instances.status} not in ${FINISHED_SQL}`))
				.returning({ seq: instances.seq });
			if (!row) {
				const [found] = await tx
					.select({ id: instances.id })
					.from(instances)
					.where(this.instance(workflow, id));
				return found ? 'finished' : 'missing';
			}
			await tx
				.insert(events)
				.values({ workflow, id, seq: row.seq, type, payload: jsonValue(payload), at: dateOf(now) });
			return 'sent';
		});
	}

	public async terminate(workflow: string, id: string, now: number): Promise<boolean> {
		const t = this.tables.instances;
		const stopped = await this.db
			.update(t)
			.set({
				status: 'terminated',
				wakeAt: null,
				leaseOwner: null,
				leaseUntil: null,
				updatedAt: dateOf(now)
			})
			.where(and(this.instance(workflow, id), sql`${t.status} not in ${FINISHED_SQL}`))
			.returning({ id: t.id });
		return stopped.length > 0;
	}

	public async purge(before: number): Promise<number> {
		const { instances, steps, events } = this.tables;
		const batch = this.options.purgeBatch ?? 1000;
		const pairs = (
			table: { workflow: unknown; id: unknown },
			keys: { workflow: string; id: string }[]
		) =>
			sql`(${table.workflow}, ${table.id}) in (${sql.join(
				keys.map(({ workflow, id }) => sql`(${workflow}, ${id})`),
				sql`, `
			)})`;
		let total = 0;
		for (;;) {
			// The instances are deleted first, by a statement that checks again that each one is still
			// finished and old, so that a new instance created under a purged id is never deleted.
			const removed = await this.worker.transaction(async (tx) => {
				const keys = await tx
					.delete(instances)
					.where(
						sql`(${instances.workflow}, ${instances.id}) in (select ${instances.workflow}, ${instances.id} from ${instances} where ${instances.status} in ${FINISHED_SQL} and ${instances.updatedAt} < ${dateOf(before)}::timestamptz limit ${batch} for update skip locked)`
					)
					.returning({ workflow: instances.workflow, id: instances.id });
				if (keys.length > 0) {
					await tx.delete(steps).where(pairs(steps, keys));
					await tx.delete(events).where(pairs(events, keys));
				}
				return keys.length;
			});
			total += removed;
			if (removed < batch) return total;
		}
	}
}
