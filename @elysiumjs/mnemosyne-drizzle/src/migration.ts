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
import type { PgTable } from 'drizzle-orm/pg-core';
import type { CreatedTable, PartitionColumn, TableMarker } from './table-markers';

import { Service } from '@elysiumjs/core';

import { markTable } from './table-markers';

/**
 * The transaction `migration:run` hands to its hooks: a `Bun.SQL` client.
 */
// portability-allow: a type only, migration:run runs on Bun
type MigrationClient = Bun.SQL;

/**
 * A run of `migration:run`, as its hooks see it.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type MigrationRun = {
	/** The transaction of the run. */
	readonly sql: MigrationClient;

	/** The tenant the migrations run in: the schema set as `search_path`. */
	readonly tenant: string;

	/** The name of the connection the migrations run on. */
	readonly connection: string;

	/** The batch number of the migrations applied by this run. */
	readonly batch: number;

	/** The names of the migrations this run applies, in order. Empty when none is pending. */
	readonly pending: readonly string[];

	/** The names of the migrations applied so far by this run, in order. */
	readonly applied: readonly string[];
};

/**
 * One migration of a run, as the hooks see it.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type MigrationStep = {
	/** The transaction of the run. */
	readonly sql: MigrationClient;

	/** The name of the migration. */
	readonly name: string;

	/** The absolute path of the migration file. */
	readonly path: string;

	/** The run the migration is part of. */
	readonly run: MigrationRun;
};

/**
 * Runs SQL around the migrations of `migration:run`, inside its transaction and after its lock:
 * what fails rolls the whole run back. Every method is optional.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export interface MigrationHook {
	/**
	 * Runs before the pending migrations, once the tenant schema and the migrations table exist.
	 * @param run The run.
	 */
	before?(run: MigrationRun): Promise<void> | void;

	/**
	 * Runs before each migration.
	 * @param step The migration about to be applied.
	 */
	beforeEach?(step: MigrationStep): Promise<void> | void;

	/**
	 * Runs after each migration, once it is recorded, before the next one.
	 * @param step The migration just applied.
	 */
	afterEach?(step: MigrationStep): Promise<void> | void;

	/**
	 * Runs after the pending migrations, also when there is none.
	 * @param run The run.
	 */
	after?(run: MigrationRun): Promise<void> | void;
}

/**
 * Migrations: the hooks that `migration:run` calls around them, and the markers that
 * `migration:generate` applies to the migration creating a table.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export namespace Migration {
	/**
	 * The tag of the migration hooks.
	 */
	export const Hooks = Service.tag<MigrationHook>('mnemosyne.migration.hooks');

	/**
	 * Registers a service as a migration hook. Hooks run in the order the modules register them,
	 * for every tenant: read `run.tenant` to act on some of them only.
	 * @example
	 * ```ts
	 * @Migration.hook()
	 * export class GrantsHook implements MigrationHook {
	 * 	public async after({ sql, tenant }: MigrationRun) {
	 * 		await sql`GRANT USAGE ON SCHEMA ${sql(tenant)} TO app`;
	 * 	}
	 * }
	 * ```
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param props The service options.
	 */
	export const hook = (props: Parameters<typeof Service.register>[0] = {}) =>
		Service.register({ ...props, tags: [...(props?.tags ?? []), Hooks] });

	/**
	 * Marks a table with what `migration:generate` adds to the migration that creates it. Later
	 * migrations, and tables created before the markers were added, are left as they are.
	 * @example
	 * ```ts
	 * export const audit = Migration.table(
	 * 	Migration.partitioned({ range: 'recorded_at' }),
	 * 	Migration.afterCreate(
	 * 		({ qualified }) =>
	 * 			`CREATE TRIGGER audit_append_only BEFORE UPDATE OR DELETE ON ${qualified} FOR EACH ROW EXECUTE FUNCTION forbid_change()`
	 * 	)
	 * )(
	 * 	kernel.table('audit', { ... }, (t) => [primaryKey({ columns: [t.id, t.recordedAt] })])
	 * );
	 * ```
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param markers The markers, from `Migration.partitioned()` and `Migration.afterCreate()`.
	 * @returns A function marking the table and returning it.
	 */
	export const table =
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
