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

import type { MigrationConnection, MigrationDatabase, MigrationRun } from '../migration';

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { Command, CommandArgumentType, Service } from '@elysiumjs/core';
import { isValidTenantId } from '@elysiumjs/mnemosyne';
import { sql } from 'drizzle-orm';

import { closeConnection, Database, getConnectionDriver } from '../database';
import { Migration } from '../migration';
import { getMigrationName, planMigrations } from '../migrations';
import { getMigrationsPath } from './project';

/**
 * Lists the `.sql` files under a folder, at any depth, as absolute paths.
 * @param folder The migrations folder.
 */
const listMigrationFiles = async (folder: string): Promise<string[]> => {
	const entries = await readdir(folder, { recursive: true, withFileTypes: true }).catch(
		(error: NodeJS.ErrnoException) => {
			if (error.code === 'ENOENT') return [];
			throw error;
		}
	);
	return entries
		.filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
		.map((entry) => join(entry.parentPath, entry.name));
};

/**
 * Execute migration files.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
@Command.register()
export class MigrationRunCommand extends Command {
	public static readonly command: string = 'migration:run';
	public static readonly description: string = 'Runs pending migrations.';

	@Command.arg({
		description: 'The name of the tenant in which the migrations will be executed.',
		type: CommandArgumentType.STRING,
		required: true
	})
	private tenant: string = '';

	@Command.arg({
		description: 'The name of the connection to use.',
		type: CommandArgumentType.STRING,
		default: 'default'
	})
	private connection: string = 'default';

	@Command.arg({
		description: 'Drop the entire schema before running the migrations.',
		type: CommandArgumentType.BOOLEAN,
		default: false
	})
	private fresh: boolean = false;

	@Command.arg({
		name: 'create-schema',
		description: 'Create the tenant schema without asking when it does not exist.',
		type: CommandArgumentType.BOOLEAN,
		default: false
	})
	private createSchema: boolean = false;

	public async run(): Promise<void> {
		if (!isValidTenantId(this.tenant)) {
			this.error(
				`Invalid tenant ${this.bold(this.tenant)}: use 1 to 63 letters, digits, underscores or ` +
					'dashes, not starting with pg_ and other than information_schema.'
			);
			return process.exit(1);
		}

		if (!Database.connectionExists(this.connection)) {
			this.error(`Connection ${this.bold(this.connection)} does not exist.`);
			return process.exit(1);
		}

		const connection = Database.getConnection(this.connection);
		const driver = getConnectionDriver(connection);
		if (!driver?.migrations) {
			this.error(
				`Connection ${this.bold(this.connection)} uses the ${this.bold(driver?.name ?? 'unknown')} ` +
					'driver, which cannot run migrations. Use a connection on the bun-sql, postgres-js ' +
					'or node-postgres driver with --connection.'
			);
			return process.exit(1);
		}

		try {
			const db = driver.migrations(connection);

			// Decide everything that needs the user before opening the transaction, so that no
			// prompt keeps it (and its lock) open.
			if (!this.fresh && !(await this.ensureSchemaChoice(db))) return process.exit(1);

			await this.migrate(db);
		} finally {
			await closeConnection(connection);
		}
	}

	/**
	 * Runs the pending migrations in one transaction.
	 * @param connection The migration connection.
	 */
	private async migrate(connection: MigrationConnection): Promise<void> {
		await connection.transaction(async (db: MigrationDatabase) => {
			const schema = sql.identifier(this.tenant);

			// Serialises concurrent runs for the same tenant: the lock is released at commit.
			await db.execute(
				sql`SELECT pg_advisory_xact_lock(hashtext(${`elysium_migrations:${this.tenant}`}))`
			);

			if (this.fresh) {
				await db.execute(sql`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
			}
			await db.execute(sql`CREATE SCHEMA IF NOT EXISTS ${schema}`);

			await db.execute(sql`SET LOCAL search_path TO ${schema}`);

			await db.execute(sql`CREATE TABLE IF NOT EXISTS elysium_migrations (
				id SERIAL PRIMARY KEY,
				name TEXT NOT NULL,
				batch INTEGER NOT NULL,
				applied_at TIMESTAMP NOT NULL
			)`);
			// Also added to tables created by earlier versions.
			await db.execute(
				sql`CREATE UNIQUE INDEX IF NOT EXISTS elysium_migrations_name_unique ON elysium_migrations (name)`
			);

			const rows = await db.execute<{ name: string; applied_at: Date }>(
				sql`SELECT name, applied_at FROM elysium_migrations`
			);
			const completedMigrations = rows.map((row) => ({
				name: row.name,
				appliedAt: row.applied_at
			}));

			const files = await listMigrationFiles(getMigrationsPath());
			const { pending: sqlFiles, renames } = planMigrations(files, completedMigrations);

			for (const { from, to } of renames) {
				await db.execute(sql`UPDATE elysium_migrations SET name = ${to} WHERE name = ${from}`);
				this.info(`Migration ${this.bold(from)} is now tracked as ${this.bold(to)}.`);
			}

			const hooks = await Service.resolveAll(Migration.Hooks);

			const [{ max } = { max: null }] = await db.execute<{ max: number | null }>(
				sql`SELECT MAX(batch) + 1 AS max FROM elysium_migrations`
			);

			const applied: string[] = [];
			const run: MigrationRun = {
				db,
				tenant: this.tenant,
				connection: this.connection,
				batch: Number(max ?? 0),
				pending: sqlFiles.map((path) => getMigrationName(path)),
				applied
			};

			for (const hook of hooks) await hook.before?.(run);

			if (sqlFiles.length === 0) {
				this.success('No new migrations to apply.');
			} else {
				const s = this.spinner(`Running migrations for tenant ${this.bold(this.tenant)}...`);

				for (const path of sqlFiles) {
					const step = { db, name: getMigrationName(path), path, run };
					for (const hook of hooks) await hook.beforeEach?.(step);

					await db.script(await readFile(path, 'utf8'));
					await db.execute(
						sql`INSERT INTO elysium_migrations (name, batch, applied_at) VALUES (${step.name}, ${run.batch}, now())`
					);
					applied.push(step.name);

					for (const hook of hooks) await hook.afterEach?.(step);
					s.pause(`Migration ${this.bold(step.name)} applied successfully.`);
				}

				s.complete(`Migrations for tenant ${this.bold(this.tenant)} applied successfully.`);
			}

			for (const hook of hooks) await hook.after?.(run);
		});
	}

	/**
	 * Checks that the tenant schema exists, or that it may be created: with `--create-schema`, or
	 * when the user agrees. Without a terminal to ask, a missing schema is an error.
	 * @param db The migration connection.
	 * @returns `false` if the schema must not be created.
	 */
	private async ensureSchemaChoice(db: MigrationDatabase): Promise<boolean> {
		const [{ schema_exists } = { schema_exists: false }] = await db.execute<{
			schema_exists: boolean;
		}>(sql`SELECT EXISTS (
			SELECT schema_name
			  FROM information_schema.schemata
			 WHERE schema_name = ${this.tenant}
		) AS schema_exists`);
		if (schema_exists || this.createSchema) return true;

		if (!process.stdin.isTTY) {
			this.error(
				`Schema ${this.bold(this.tenant)} does not exist. Run again with --create-schema to ` +
					'create it.'
			);
			return false;
		}

		// Loaded on use: prompts needs Node.js streams, which Workers bundles leave out.
		const { default: prompts } = await import('prompts');
		const answers = await prompts(
			[
				{
					type: 'confirm',
					name: 'create',
					message: `Schema ${this.tenant} does not exist. Do you want to create it?`,
					initial: true
				}
			],
			{
				onCancel: () => {
					this.error('Operation cancelled.');
					process.exit(0);
				}
			}
		);

		if (!answers.create) {
			this.error(`Schema ${this.bold(this.tenant)} creation cancelled.`);
			return false;
		}
		return true;
	}
}
