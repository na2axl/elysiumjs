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
	ModelClass,
	OffsetPage,
	Page,
	ParsedQuery,
	RowKey
} from '@elysiumjs/olympus/mnemosyne';
import type { SQL } from 'drizzle-orm';
import type { PgColumn, PgTable, PgTableWithColumns } from 'drizzle-orm/pg-core';
import type { DrizzleConnection } from './database';

import { ElysiumError } from '@elysiumjs/olympus';
import {
	AbstractRepository,
	getCurrentTenant,
	getTenancyConfig,
	getTenancyStrategy,
	Listing
} from '@elysiumjs/olympus/mnemosyne';
import { and, eq, getTableColumns } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';

import { Database } from './database';
import { compileQuery } from './query';
import { DrizzleRLSTenancy } from './tenancy';

// ============================================================================
// DrizzleRepository Mixin
// ============================================================================

/**
 * Raised when a repository cannot tell the primary key of its table, or gets a key that does not
 * match it.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class RepositoryKeyError extends ElysiumError {}

/**
 * Options of {@link DrizzleRepository}.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type DrizzleRepositoryOptions<TSelect> = {
	/**
	 * The columns of the primary key, by their property names. Defaults to the primary key of the
	 * table: its `primaryKey({ columns })`, else its `.primaryKey()` columns.
	 */
	key?: readonly (keyof TSelect & string)[];
};

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

/**
 * Drizzle-specific repository mixin with concrete CRUD operations.
 *
 * Extends the abstract repository with Drizzle query builder calls for all standard CRUD methods.
 * `find`, `update`, `delete` and `exists` take the primary key of the table: its value, or an
 * object of the values of its columns when it spans several, such as
 * `{ userId, creatorId }`.
 *
 * @author Axel Nana <ax.lnana@outlook.com>
 * @template TModel The model class type.
 * @param model The model class to create the repository for.
 * @param options The columns of the primary key, when they differ from the table's.
 * @returns A concrete repository class with CRUD methods.
 * @example
 * ```ts
 * export const follows = pgTable(
 * 	'follows',
 * 	{ userId: uuid().notNull(), creatorId: uuid().notNull() },
 * 	(t) => [primaryKey({ columns: [t.userId, t.creatorId] })]
 * );
 *
 * class FollowRepository extends DrizzleRepository(FollowModel) {}
 *
 * await repository.find({ userId, creatorId });
 * ```
 */
export const DrizzleRepository = <TModel extends ModelClass<any, any, any, PgTable>>(
	model: TModel,
	options: DrizzleRepositoryOptions<TModel['$inferSelect']> = {}
) => {
	type TSelect = TModel['$inferSelect'];
	type TKey = RowKey | Partial<TSelect>;
	type TInsert = TModel['$inferInsert'];
	type TUpdate = TModel['$inferUpdate'];

	/**
	 * Gets the model table, resolved for the current tenant on each call. Typed loosely for the
	 * query builders.
	 */
	const table = () => model.table as unknown as PgTableWithColumns<any>;

	let keyColumns: readonly string[] | undefined;
	/** The property names of the primary key columns, read from the table once. */
	const key = (): readonly string[] => {
		keyColumns ??= options.key ?? primaryKeyOf(table());
		if (keyColumns.length === 0)
			throw new RepositoryKeyError(
				`The table of ${model.name} has no primary key: declare one, or pass \`key\` to DrizzleRepository().`
			);
		return keyColumns;
	};

	/** The condition that selects the row of a key. */
	const whereKey = (id: TKey): SQL => {
		const columns = key();
		const t = table();
		if (typeof id !== 'object' || id === null) {
			if (columns.length > 1)
				throw new RepositoryKeyError(
					`The primary key of ${model.name} spans ${columns.join(', ')}: pass an object of their values.`
				);
			return eq(t[columns[0]!], id);
		}
		const values = id as Record<string, unknown>;
		const missing = columns.filter((column) => values[column] === undefined);
		if (missing.length > 0)
			throw new RepositoryKeyError(`The key of ${model.name} misses ${missing.join(', ')}.`);
		return and(...columns.map((column) => eq(t[column], values[column])))!;
	};

	/** Two conditions together, either of which may be left out. */
	const both = (a: SQL | undefined, b: SQL | undefined): SQL | undefined =>
		a && b ? and(a, b) : (a ?? b);

	class R extends AbstractRepository<TModel, DrizzleConnection>(model, Database) {
		/**
		 * Runs a database operation on the repository connection.
		 *
		 * In RLS tenancy mode, an operation that runs outside a transaction is wrapped in one
		 * scoped to the current tenant (through the tenancy strategy's `withIsolation`), so RLS
		 * policies apply to it. Inside an open transaction, the operation joins it when the
		 * transaction is bound to the current tenant, and throws `TenantMismatchError` otherwise
		 * (see `DrizzleRLSTenancy.withIsolation`).
		 * @param operation The operation to run with the connection to use.
		 * @returns The return value of the operation.
		 */
		public async withConnection<T>(operation: (db: DrizzleConnection) => Promise<T>): Promise<T> {
			const name = (this.constructor as typeof R).connection;
			if (getTenancyConfig().mode !== 'rls') return operation(this.db);

			const strategy = getTenancyStrategy() ?? new DrizzleRLSTenancy();
			return strategy.withIsolation(
				Database.getBaseConnection(name),
				getCurrentTenant() ?? 'public',
				() => operation(this.db)
			);
		}

		public async all(): Promise<TSelect[]> {
			return this.withConnection((db) => db.select().from(table()));
		}

		/**
		 * @deprecated Use `list()` with a spec whose `pagination` is `offset`: it applies the
		 * filters and the sort of the query string.
		 */
		public async paginate(
			count: number,
			page: number = 1
		): Promise<{ page: number; data: TSelect[]; total: number }> {
			const offset = Math.max(page - 1, 0) * count;
			return this.withConnection(async (db) => ({
				page,
				total: await db.$count(table()),
				data: await db.select().from(table()).offset(offset).limit(count)
			}));
		}

		public async find(id: TKey): Promise<TSelect | null> {
			const [row] = await this.withConnection((db) =>
				db.select().from(table()).where(whereKey(id))
			);
			return (row ?? null) as TSelect | null;
		}

		public async findBy<TKey extends keyof TSelect>(
			column: TKey,
			value: TSelect[TKey]
		): Promise<TSelect | null> {
			const [row] = await this.withConnection((db) =>
				db.select().from(table()).where(eq(table()[column], value))
			);
			return (row ?? null) as TSelect | null;
		}

		public async insert(data: TInsert): Promise<TSelect> {
			const [row] = await this.withConnection((db) => db.insert(table()).values(data).returning());
			return row as TSelect;
		}

		public async update(id: TKey, data: TUpdate): Promise<TSelect | null> {
			const [row] = await this.withConnection((db) =>
				db.update(table()).set(data).where(whereKey(id)).returning()
			);
			return (row ?? null) as TSelect | null;
		}

		public async updateAll(data: TUpdate): Promise<TSelect[]> {
			return this.withConnection((db) => db.update(table()).set(data).returning());
		}

		public async delete(id: TKey): Promise<TSelect | null> {
			const [row] = await this.withConnection((db) =>
				db.delete(table()).where(whereKey(id)).returning()
			);
			return (row ?? null) as TSelect | null;
		}

		public async deleteAll(): Promise<TSelect[]> {
			return this.withConnection((db) => db.delete(table()).returning());
		}

		/**
		 * Lists a page of rows matching a parsed query (see `Listing.parse`): its filters, its sort and
		 * its page. With cursor pagination, one row more than the limit is fetched to tell whether a
		 * next page exists. With offset pagination, the rows matching the filters are counted.
		 * @param query The parsed query.
		 * @param scope A condition the rows must also meet, such as their owner, ANDed with the
		 * filters of the query.
		 * @returns The rows of the page and the cursor of the next one, or the page and the total.
		 * @example
		 * ```ts
		 * return this.list(query, eq(posts.authorId, userId));
		 * ```
		 */
		public async list(query: ParsedQuery<'offset'>, scope?: SQL): Promise<OffsetPage<TSelect>>;
		public async list(query: ParsedQuery<'cursor'>, scope?: SQL): Promise<CursorPage<TSelect>>;
		public async list(query: ParsedQuery, scope?: SQL): Promise<Page<TSelect>>;
		public async list(query: ParsedQuery, scope?: SQL): Promise<Page<TSelect>> {
			const compiled = compileQuery(table(), query);
			const where = both(compiled.where, scope);
			const { orderBy } = compiled;
			if (query.page !== undefined) {
				const offsetQuery = query as ParsedQuery<'offset'>;
				return this.withConnection(async (db) => {
					const rows = await db
						.select()
						.from(table())
						.where(where)
						.orderBy(...orderBy)
						.offset((offsetQuery.page - 1) * offsetQuery.limit)
						.limit(offsetQuery.limit);
					const total = await db.$count(table(), where);
					return Listing.offsetPage(offsetQuery, rows as TSelect[], total);
				});
			}
			const rows = await this.withConnection((db) =>
				db
					.select()
					.from(table())
					.where(where)
					.orderBy(...orderBy)
					.limit(query.limit + 1)
			);
			return Listing.page(query, rows as Record<string, unknown>[]) as CursorPage<TSelect>;
		}

		/**
		 * Counts the rows matching the filters of a parsed query, ignoring its cursor.
		 * @param query The parsed query.
		 * @param scope A condition the rows must also meet, as for `list()`.
		 */
		public async count(query?: ParsedQuery, scope?: SQL): Promise<number> {
			const filters = query
				? compileQuery(table(), { ...query, after: undefined }).where
				: undefined;
			return this.withConnection((db) => db.$count(table(), both(filters, scope)));
		}

		public async exists(id: TKey): Promise<boolean> {
			const count = await this.withConnection((db) => db.$count(table(), whereKey(id)));
			return count > 0;
		}
	}

	return R;
};
