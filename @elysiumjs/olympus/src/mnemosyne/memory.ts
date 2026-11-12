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

import type { ModelAdapter } from './interfaces';
import type { ParsedFilter, ParsedQuery } from './query';
import type { RepositoryAdapter, RepositoryTarget, Row } from './repository';

import { AbstractModel } from './model';
import { Listing } from './query';

const MEMORY_TABLE = Symbol('elysium:memory-table');

/**
 * A table of the in-memory backend: a name and the key columns.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type MemoryTable = {
	readonly [MEMORY_TABLE]: true;
	readonly name: string;
	readonly key: readonly string[];
};

/**
 * A scope condition of the in-memory backend: a predicate over rows.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type MemoryScope = (row: any) => boolean;

declare module './repository' {
	interface RepositoryDrivers {
		memory: { table: MemoryTable; connection: MemoryDatabase; scope: MemoryScope };
	}
}

/**
 * The rows of the in-memory backend for one connection name, by table name. Made for tests and
 * prototypes: rows live in the process, and writes do not join transactions.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class MemoryDatabase {
	static readonly #connections = new Map<string, MemoryDatabase>();
	readonly #tables = new Map<string, Row[]>();

	/**
	 * The database of a connection name, created on first use.
	 * @param name The connection name.
	 */
	public static connection(name: string = 'default'): MemoryDatabase {
		let database = MemoryDatabase.#connections.get(name);
		if (!database) {
			database = new MemoryDatabase();
			MemoryDatabase.#connections.set(name, database);
		}
		return database;
	}

	/** Forgets every connection and its rows, such as between tests. */
	public static reset(): void {
		MemoryDatabase.#connections.clear();
	}

	/**
	 * The rows of a table, kept by reference: the adapter copies them in and out.
	 * @param name The table name.
	 */
	public rows(name: string): Row[] {
		let rows = this.#tables.get(name);
		if (!rows) {
			rows = [];
			this.#tables.set(name, rows);
		}
		return rows;
	}
}

const copy = <T>(value: T): T => structuredClone(value);

/** A comparable form of a value: dates and date strings as times. */
const comparable = (value: unknown, other: unknown): unknown => {
	if (value instanceof Date) return value.getTime();
	if (typeof value === 'string' && other instanceof Date) return Date.parse(value);
	return value;
};

/** Compares two values: dates with dates or their ISO strings, numbers, strings. */
const compare = (a: unknown, b: unknown): number => {
	const x = comparable(a, b) as any;
	const y = comparable(b, a) as any;
	if (x === y) return 0;
	if (x === null || x === undefined) return -1;
	if (y === null || y === undefined) return 1;
	return x < y ? -1 : x > y ? 1 : 0;
};

const matches = (row: Row, filter: ParsedFilter): boolean => {
	const value = row[filter.column];
	const expected = filter.value;
	switch (filter.operator) {
		case 'eq':
			return compare(value, expected) === 0;
		case 'ne':
			return compare(value, expected) !== 0;
		case 'gt':
			return value != null && compare(value, expected) > 0;
		case 'gte':
			return value != null && compare(value, expected) >= 0;
		case 'lt':
			return value != null && compare(value, expected) < 0;
		case 'lte':
			return value != null && compare(value, expected) <= 0;
		case 'in':
			return (expected as unknown[]).some((item) => compare(value, item) === 0);
		case 'contains':
			return String(value ?? '')
				.toLowerCase()
				.includes(String(expected).toLowerCase());
		case 'startsWith':
			return String(value ?? '')
				.toLowerCase()
				.startsWith(String(expected).toLowerCase());
		case 'isNull':
			return expected ? value == null : value != null;
	}
};

/** Whether a row comes after the cursor of a query, in its sort order. */
const afterCursor = (row: Row, query: ParsedQuery): boolean => {
	if (!query.after) return true;
	for (const [index, key] of query.sort.entries()) {
		const order = compare(row[key.column], query.after[index]);
		if (order !== 0) return key.direction === 'asc' ? order > 0 : order < 0;
	}
	return false;
};

const sorted = (rows: Row[], query: ParsedQuery): Row[] =>
	[...rows].sort((a, b) => {
		for (const key of query.sort) {
			const order = compare(a[key.column], b[key.column]);
			if (order !== 0) return key.direction === 'asc' ? order : -order;
		}
		return 0;
	});

const sameKey = (row: Row, key: Row): boolean =>
	Object.entries(key).every(([column, value]) => compare(row[column], value) === 0);

const tableOf = (target: RepositoryTarget<MemoryTable>): Row[] =>
	MemoryDatabase.connection(target.connection).rows(target.table.name);

const filtered = (rows: Row[], query?: ParsedQuery, scope?: MemoryScope): Row[] =>
	rows.filter(
		(row) =>
			(!scope || scope(row)) && (!query || query.filters.every((filter) => matches(row, filter)))
	);

/**
 * The repository adapter of the in-memory backend. Rows are copied in and out, so that a caller
 * never changes them in place. A single-column key missing from an inserted row gets a random
 * UUID.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export const memoryRepositoryAdapter: RepositoryAdapter<MemoryTable, MemoryDatabase, MemoryScope> =
	{
		primaryKey: (table) => table.key,
		connection: (name) => MemoryDatabase.connection(name),
		run: (name, operation) => operation(MemoryDatabase.connection(name)),

		async all(target) {
			return copy(tableOf(target));
		},

		async find(target, key) {
			const row = tableOf(target).find((item) => sameKey(item, key));
			return row ? copy(row) : null;
		},

		async findBy(target, column, value) {
			const row = tableOf(target).find((item) => compare(item[column], value) === 0);
			return row ? copy(row) : null;
		},

		async findWhere(target, scope, limit) {
			return copy(tableOf(target).filter(scope).slice(0, limit));
		},

		async insert(target, data) {
			const row = copy(data);
			const [only] = target.key;
			if (target.key.length === 1 && row[only!] === undefined) row[only!] = crypto.randomUUID();
			tableOf(target).push(row);
			return copy(row);
		},

		async update(target, key, data) {
			const row = tableOf(target).find((item) => sameKey(item, key));
			if (!row) return null;
			Object.assign(row, copy(data));
			return copy(row);
		},

		async updateAll(target, data) {
			const rows = tableOf(target);
			for (const row of rows) Object.assign(row, copy(data));
			return copy(rows);
		},

		async delete(target, key) {
			const rows = tableOf(target);
			const index = rows.findIndex((item) => sameKey(item, key));
			if (index < 0) return null;
			return rows.splice(index, 1)[0]!;
		},

		async deleteMany(target, keys) {
			const rows = tableOf(target);
			const before = rows.length;
			const kept = rows.filter((row) => !keys.some((key) => sameKey(row, key)));
			rows.splice(0, rows.length, ...kept);
			return before - rows.length;
		},

		async deleteAll(target) {
			const rows = tableOf(target);
			return rows.splice(0, rows.length);
		},

		async deleteWhere(target, scope, limit = Infinity) {
			const rows = tableOf(target);
			let deleted = 0;
			for (let index = 0; index < rows.length && deleted < limit;) {
				if (scope(rows[index])) {
					rows.splice(index, 1);
					deleted++;
				} else index++;
			}
			return deleted;
		},

		async exists(target, key) {
			return tableOf(target).some((item) => sameKey(item, key));
		},

		async list(target, query, scope) {
			const rows = sorted(filtered(tableOf(target), query, scope), query);
			if (query.page !== undefined) {
				const offset = query as ParsedQuery<'offset'>;
				const start = (offset.page - 1) * offset.limit;
				return Listing.offsetPage(
					offset,
					copy(rows.slice(start, start + offset.limit)),
					rows.length
				);
			}
			const after = rows.filter((row) => afterCursor(row, query));
			return Listing.page(query, copy(after.slice(0, query.limit + 1)));
		},

		async count(target, query, scope) {
			return filtered(tableOf(target), query, scope).length;
		}
	};

/**
 * The model adapter of the in-memory backend.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export const memoryModelAdapter: ModelAdapter<MemoryTable> = {
	getTableName: (table) => table.name,
	getColumns: () => [],
	createTenantTable: (table, tenant) => ({ ...table, name: `${tenant}.${table.name}` }),
	repository: memoryRepositoryAdapter
};

/**
 * Options of {@link MemoryModel}.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type MemoryModelOptions<TRow> = {
	/** The key columns. Defaults to `['id']`. */
	key?: readonly (keyof TRow & string)[];
	/** Whether the rows are kept per tenant. */
	supportTenancy?: boolean;
};

/**
 * Creates a model of the in-memory backend, for tests and prototypes: its repositories keep
 * their rows in the process. The row type is given as a type argument.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @param name The table name.
 * @param options The key columns and tenancy.
 * @example
 * ```ts
 * type Book = { id: string; title: string; authorId: string };
 *
 * class BookModel extends MemoryModel<Book>('books') {}
 * class BookRepository extends Repository(BookModel) {}
 *
 * const book = await new BookRepository().insert({ title: 'Dune', authorId: 'a-1' });
 * ```
 */
export const MemoryModel = <TRow extends Row, TInsert = Partial<TRow>, TUpdate = Partial<TRow>>(
	name: string,
	options: MemoryModelOptions<TRow> = {}
) => {
	const table: MemoryTable = { [MEMORY_TABLE]: true, name, key: options.key ?? ['id'] };
	const Base = AbstractModel(name, {}, memoryModelAdapter, table);
	if (options.supportTenancy !== undefined) {
		Object.defineProperty(Base, 'supportTenancy', { value: options.supportTenancy });
	}
	return Base as typeof Base & {
		readonly $inferSelect: TRow;
		readonly $inferInsert: TInsert;
		readonly $inferUpdate: TUpdate;
		readonly table: MemoryTable;
	};
};
