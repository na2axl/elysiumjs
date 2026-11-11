// Copyright (c) 2025-present Workbud Technologies Inc. All rights reserved.
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

import type { SQL } from 'drizzle-orm';
import type { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core';

import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core';

/**
 * A table as the SQL that follows its creation sees it.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type CreatedTable = {
	/** The Postgres schema of the table, `undefined` for `public`. */
	readonly schema: string | undefined;

	/** The name of the table. */
	readonly name: string;

	/** The quoted, schema-qualified name of the table: `"kernel"."audit"`. */
	readonly qualified: string;
};

/**
 * A column a partition key is made of: its name in the database, or a function returning the
 * column of the table.
 */
export type PartitionColumn = string | ((table: any) => AnyPgColumn);

/**
 * What `migration:generate` adds to the migration that creates a table.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type TableMarker = {
	/** The columns of the range partition key. */
	readonly range?: readonly PartitionColumn[];

	/** The SQL to run after the table is created. */
	readonly afterCreate?: ReadonlyArray<(table: CreatedTable) => string | SQL>;
};

const MARKERS = Symbol.for('elysium:mnemosyne-drizzle:table-markers');

/**
 * Attaches markers to a table, after the ones it already has.
 * @author Axel Nana <axel.nana@workbud.com>
 * @param table The table.
 * @param markers The markers.
 * @returns The table.
 */
export const markTable = <T extends PgTable>(table: T, markers: readonly TableMarker[]): T => {
	const current = getTableMarker(table);
	const range = markers.reduce<readonly PartitionColumn[] | undefined>(
		(acc, marker) => marker.range ?? acc,
		current?.range
	);
	const afterCreate = [
		...(current?.afterCreate ?? []),
		...markers.flatMap((marker) => marker.afterCreate ?? [])
	];
	Object.defineProperty(table, MARKERS, {
		value: { range, afterCreate } satisfies TableMarker,
		configurable: true,
		enumerable: false
	});
	return table;
};

/**
 * Reads the markers of a table.
 * @author Axel Nana <axel.nana@workbud.com>
 * @param table The table.
 * @returns The markers merged into one, or `undefined` when the table has none.
 */
export const getTableMarker = (table: object): TableMarker | undefined =>
	(table as { [MARKERS]?: TableMarker })[MARKERS];

const quote = (identifier: string) => `"${identifier.replaceAll('"', '""')}"`;

/**
 * Finds the end of a statement: the index right after its `;`, skipping quoted strings,
 * identifiers and comments. The length of the SQL when it has none.
 */
const endOfStatement = (sql: string, from: number): number => {
	let i = from;
	while (i < sql.length) {
		const char = sql[i]!;
		if (char === ';') return i + 1;
		if (char === "'" || char === '"') {
			i++;
			while (i < sql.length) {
				if (sql[i] === char) {
					if (sql[i + 1] === char) i += 2;
					else break;
				} else i++;
			}
			i++;
		} else if (char === '-' && sql[i + 1] === '-') {
			const end = sql.indexOf('\n', i);
			i = end < 0 ? sql.length : end + 1;
		} else if (char === '$') {
			const tag = /^\$[A-Za-z_]*\$/.exec(sql.slice(i))?.[0];
			if (tag) {
				const end = sql.indexOf(tag, i + tag.length);
				i = end < 0 ? sql.length : end + tag.length;
			} else i++;
		} else i++;
	}
	return sql.length;
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Applies the markers of the given tables to the migration that creates them: the partition key
 * after `CREATE TABLE`, then the SQL to run after it, each as its own statement. A table the
 * migration does not create is left as it is.
 * @author Axel Nana <axel.nana@workbud.com>
 * @param sql The SQL of the migration, without the `public` qualifiers.
 * @param tables The tables of the app.
 * @returns The SQL with the markers applied.
 */
export const applyTableMarkers = (sql: string, tables: Iterable<PgTable>): string => {
	const dialect = new PgDialect();
	let output = sql;

	for (const table of tables) {
		const marker = getTableMarker(table);
		if (!marker) continue;

		const { schema, name } = getTableConfig(table);
		const qualified =
			schema && schema !== 'public' ? `${quote(schema)}.${quote(name)}` : quote(name);
		const create = new RegExp(`CREATE TABLE (?:IF NOT EXISTS )?${escapeRegExp(qualified)}\\s*\\(`);
		const match = create.exec(output);
		if (!match) continue;

		const end = endOfStatement(output, match.index + match[0].length);
		let statement = output.slice(match.index, end).replace(/;$/, '');

		if (marker.range?.length) {
			const columns = marker.range.map((column) =>
				quote(typeof column === 'string' ? column : column(table).name)
			);
			statement += ` PARTITION BY RANGE (${columns.join(', ')})`;
		}
		statement += ';';

		const created: CreatedTable = {
			schema: schema === 'public' ? undefined : schema,
			name,
			qualified
		};
		for (const after of marker.afterCreate ?? []) {
			const value = after(created);
			const text = typeof value === 'string' ? value : dialect.sqlToQuery(value.inlineParams()).sql;
			statement += `\n--> statement-breakpoint\n${text.trim().replace(/;?$/, ';')}`;
		}

		output = output.slice(0, match.index) + statement + output.slice(end);
	}

	return output;
};

/**
 * Drizzle tables: the markers that `migration:generate` applies to the migration creating a table.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export namespace DrizzleTable {
	/**
	 * Marks a table with what `migration:generate` adds to the migration that creates it. Later
	 * migrations, and tables created before the markers were added, are left as they are.
	 * @example
	 * ```ts
	 * export const audit = DrizzleTable.define(
	 * 	DrizzleTable.partitioned({ range: 'recorded_at' }),
	 * 	DrizzleTable.afterCreate(
	 * 		({ qualified }) =>
	 * 			`CREATE TRIGGER audit_append_only BEFORE UPDATE OR DELETE ON ${qualified} FOR EACH ROW EXECUTE FUNCTION forbid_change()`
	 * 	)
	 * )(
	 * 	kernel.table('audit', { ... }, (t) => [primaryKey({ columns: [t.id, t.recordedAt] })])
	 * );
	 * ```
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param markers The markers, from `DrizzleTable.partitioned()` and `DrizzleTable.afterCreate()`.
	 * @returns A function marking the table and returning it.
	 */
	export const define =
		(...markers: TableMarker[]) =>
		<T extends PgTable>(target: T): T =>
			markTable(target, markers);

	/**
	 * Creates the table partitioned by range: `PARTITION BY RANGE (...)` follows its `CREATE TABLE`.
	 * The primary key and the unique constraints of the table must include the partition columns.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param options The partition key: a column name in the database, a function returning the
	 * column, or several of them.
	 */
	export const partitioned = (options: {
		range: PartitionColumn | readonly PartitionColumn[];
	}): TableMarker => ({
		range: Array.isArray(options.range)
			? (options.range as readonly PartitionColumn[])
			: [options.range as PartitionColumn]
	});

	/**
	 * Runs SQL right after the table is created, in the same migration: partitions, triggers or
	 * grants that belong to the table.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param build Returns the SQL, as a string or a `sql` template, from the created table.
	 */
	export const afterCreate = (build: (table: CreatedTable) => string | SQL): TableMarker => ({
		afterCreate: [build]
	});
}
