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

import { Service } from '@elysiumjs/core';

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
 * Migrations: the hooks that `migration:run` calls around them.
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
}
