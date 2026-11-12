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
	CursorPage,
	ParsedQuery,
	RepositoryAdapter,
	RepositoryTarget,
	Row
} from '@elysiumjs/olympus/mnemosyne';
import type { SQL } from 'drizzle-orm';
import type { PgColumn, PgTable, PgTableWithColumns } from 'drizzle-orm/pg-core';
import type { DrizzleConnection } from './database';

import {
	getCurrentTenant,
	getTenancyConfig,
	getTenancyStrategy,
	Listing
} from '@elysiumjs/olympus/mnemosyne';
import { and, eq, getTableColumns, inArray, or, sql } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';

import { Database } from './database';
import { compileQuery } from './query';
import { DrizzleRLSTenancy } from './tenancy';

declare module '@elysiumjs/olympus/mnemosyne' {
	interface RepositoryDrivers {
		drizzle: { table: PgTable; connection: DrizzleConnection; scope: SQL };
	}
}

type Target = RepositoryTarget<PgTable>;

/** The table of a target, typed loosely for the query builders. */
const tableOf = (target: Target) => target.table as unknown as PgTableWithColumns<any>;

/** The property names of the primary key columns of a table, matched by their database names. */
const primaryKeyOf = (table: PgTable): string[] => {
	const names = new Map(
		Object.entries(getTableColumns(table)).map(([name, column]) => [
			(column as PgColumn).name,
			name
		])
	);
	const config = getTableConfig(table);
	const composite = config.primaryKeys[0]?.columns;
	const columns = composite ?? config.columns.filter((column) => column.primary);
	return columns.map((column) => names.get(column.name)).filter((name) => name !== undefined);
};

/** The condition that selects the row of a key, given as the values of its columns. */
const whereKey = (target: Target, key: Row): SQL => {
	const table = tableOf(target);
	return and(...Object.entries(key).map(([column, value]) => eq(table[column], value)))!;
};

/** Two conditions together, either of which may be left out. */
const both = (a: SQL | undefined, b: SQL | undefined): SQL | undefined =>
	a && b ? and(a, b) : (a ?? b);

/**
 * At most `limit` rows of a scope, by their physical row id, for the bounded statements. The
 * table oid joins the row id so that it stays unique across the partitions of a partitioned
 * table, and the scope is checked again on the rows the statement reaches.
 */
const limited = (target: Target, scope: SQL, limit?: number): SQL =>
	limit === undefined
		? scope
		: and(
				scope,
				sql`(tableoid, ctid) in (select tableoid, ctid from ${target.table} where ${scope} limit ${limit})`
			)!;

/**
 * Runs an operation on a connection. In RLS tenancy mode, an operation outside a transaction is
 * wrapped in one scoped to the current tenant, so that the policies apply to it; inside an open
 * transaction, it joins it when that transaction is bound to the current tenant, and throws
 * `TenantMismatchError` otherwise.
 */
const run = async <T>(
	name: string,
	operation: (db: DrizzleConnection) => Promise<T>
): Promise<T> => {
	if (getTenancyConfig().mode !== 'rls') return operation(Database.getConnection(name));
	const strategy = getTenancyStrategy() ?? new DrizzleRLSTenancy();
	return strategy.withIsolation(
		Database.getBaseConnection(name),
		getCurrentTenant() ?? 'public',
		() => operation(Database.getConnection(name))
	);
};

/**
 * The repository adapter of Drizzle: `Repository(Model)` runs on it for the models of
 * `DrizzleModel()`. Statements join the transaction open on the connection, and honour the
 * tenant isolation of row-level security.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export const drizzleRepositoryAdapter: RepositoryAdapter<PgTable, DrizzleConnection, SQL> = {
	primaryKey: primaryKeyOf,
	connection: (name) => Database.getConnection(name),
	run,

	all(target) {
		return run(target.connection, (db) => db.select().from(tableOf(target)));
	},

	async find(target, key) {
		const [row] = await run(target.connection, (db) =>
			db.select().from(tableOf(target)).where(whereKey(target, key))
		);
		return row ?? null;
	},

	async findBy(target, column, value) {
		const [row] = await run(target.connection, (db) =>
			db
				.select()
				.from(tableOf(target))
				.where(eq(tableOf(target)[column], value))
				.limit(1)
		);
		return row ?? null;
	},

	findWhere(target, scope, limit) {
		return run(target.connection, (db) => {
			const query = db.select().from(tableOf(target)).where(scope);
			return limit === undefined ? query : query.limit(limit);
		});
	},

	async insert(target, data) {
		const [row] = await run(target.connection, (db) =>
			db.insert(tableOf(target)).values(data).returning()
		);
		return row!;
	},

	async update(target, key, data) {
		const [row] = await run(target.connection, (db) =>
			db.update(tableOf(target)).set(data).where(whereKey(target, key)).returning()
		);
		return row ?? null;
	},

	updateAll(target, data) {
		return run(target.connection, (db) => db.update(tableOf(target)).set(data).returning());
	},

	async delete(target, key) {
		const [row] = await run(target.connection, (db) =>
			db.delete(tableOf(target)).where(whereKey(target, key)).returning()
		);
		return row ?? null;
	},

	async deleteMany(target, keys) {
		if (keys.length === 0) return 0;
		const [only] = target.key;
		const where =
			target.key.length === 1
				? inArray(
						tableOf(target)[only!],
						keys.map((key) => key[only!])
					)
				: or(...keys.map((key) => whereKey(target, key)));
		const rows = await run(target.connection, (db) =>
			db
				.delete(tableOf(target))
				.where(where)
				.returning({ deleted: sql<number>`1` })
		);
		return rows.length;
	},

	deleteAll(target) {
		return run(target.connection, (db) => db.delete(tableOf(target)).returning());
	},

	async deleteWhere(target, scope, limit) {
		const rows = await run(target.connection, (db) =>
			db
				.delete(tableOf(target))
				.where(limited(target, scope, limit))
				.returning({ deleted: sql<number>`1` })
		);
		return rows.length;
	},

	async exists(target, key) {
		const count = await run(target.connection, (db) =>
			db.$count(tableOf(target), whereKey(target, key))
		);
		return count > 0;
	},

	async list(target, query, scope) {
		const table = tableOf(target);
		const compiled = compileQuery(table, query);
		const where = both(compiled.where, scope);
		const { orderBy } = compiled;
		if (query.page !== undefined) {
			const offsetQuery = query as ParsedQuery<'offset'>;
			return run(target.connection, async (db) => {
				const rows = await db
					.select()
					.from(table)
					.where(where)
					.orderBy(...orderBy)
					.offset((offsetQuery.page - 1) * offsetQuery.limit)
					.limit(offsetQuery.limit);
				const total = await db.$count(table, where);
				return Listing.offsetPage(offsetQuery, rows as Row[], total);
			});
		}
		const rows = await run(target.connection, (db) =>
			db
				.select()
				.from(table)
				.where(where)
				.orderBy(...orderBy)
				.limit(query.limit + 1)
		);
		return Listing.page(query, rows as Row[]) as CursorPage<Row>;
	},

	count(target, query, scope) {
		const table = tableOf(target);
		const filters = query ? compileQuery(table, { ...query, after: undefined }).where : undefined;
		return run(target.connection, (db) => db.$count(table, both(filters, scope)));
	}
};
