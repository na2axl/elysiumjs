// Copyright (c) 2025-present Axel Nana <ax.lnana@outlook.com>. All rights reserved.
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

import { Service } from '@elysiumjs/olympus';

/**
 * Where `migration:run` runs SQL: a transaction, or the connection outside of one. Every driver
 * gives one through `DrizzleDriver.migrations()`.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export interface MigrationDatabase {
	/**
	 * Runs one statement, with its parameters.
	 * @param query The statement, from the `sql` template of Drizzle.
	 * @returns The rows of the statement.
	 */
	execute<T = Record<string, unknown>>(query: SQL): Promise<T[]>;

	/**
	 * Runs a script of several statements, without parameters, such as a migration file.
	 * @param text The script.
	 */
	script(text: string): Promise<void>;
}

/**
 * The connection `migration:run` works on, from the driver of a Drizzle connection.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export interface MigrationConnection extends MigrationDatabase {
	/**
	 * Runs a function in a transaction, committed when it resolves and rolled back when it
	 * throws.
	 * @param fn Receives the transaction.
	 */
	transaction<T>(fn: (db: MigrationDatabase) => Promise<T>): Promise<T>;
}

/**
 * A run of `migration:run`, as its hooks see it.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type MigrationRun = {
	/** The transaction of the run. */
	readonly db: MigrationDatabase;

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
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type MigrationStep = {
	/** The transaction of the run. */
	readonly db: MigrationDatabase;

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
 * @author Axel Nana <ax.lnana@outlook.com>
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
 * Migrations: the hooks that `migration:run` calls around them.
 * @author Axel Nana <ax.lnana@outlook.com>
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
	 * 	public async after({ db, tenant }: MigrationRun) {
	 * 		await db.execute(sql`GRANT USAGE ON SCHEMA ${sql.identifier(tenant)} TO app`);
	 * 	}
	 * }
	 * ```
	 * @author Axel Nana <ax.lnana@outlook.com>
	 * @param props The service options.
	 */
	export const hook = (props: Parameters<typeof Service.register>[0] = {}) =>
		Service.register({ ...props, tags: [...(props?.tags ?? []), Hooks] });
}
