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

import { Command, CommandArgumentType } from '@elysiumjs/core';
import prompts from 'prompts';

import { Database } from '../database';
import { getMigrationName, planMigrations } from '../migrations';
import { getMigrationsPath } from './project';

/**
 * Execute migration files.
 * @author Axel Nana <axel.nana@workbud.com>
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

	public async run(): Promise<void> {
		if (!Database.connectionExists(this.connection)) {
			this.error(`Connection ${this.bold(this.connection)} does not exist.`);
			return process.exit(1);
		}

		const sql = Database.getConnection(this.connection).$client;
		await sql.connect();

		// Decide everything that needs the user before opening the transaction, so that no prompt
		// keeps it (and its lock) open.
		if (!this.fresh && !(await this.ensureSchemaChoice(sql))) {
			await sql.close();
			return process.exit(1);
		}

		await sql.begin(async (sql: Bun.SQL) => {
			// Serialises concurrent runs for the same tenant: the lock is released at commit.
			await sql`SELECT pg_advisory_xact_lock(hashtext(${`elysium_migrations:${this.tenant}`}))`;

			if (this.fresh) {
				await sql`DROP SCHEMA IF EXISTS ${sql(this.tenant)} CASCADE;`;
			}
			await sql`CREATE SCHEMA IF NOT EXISTS ${sql(this.tenant)};`;

			await sql`SET LOCAL search_path TO ${sql(this.tenant)}`;

			await sql`CREATE TABLE IF NOT EXISTS elysium_migrations (
				id SERIAL PRIMARY KEY,
				name TEXT NOT NULL,
				batch INTEGER NOT NULL,
				applied_at TIMESTAMP NOT NULL
			);`;
			// Also added to tables created by earlier versions.
			await sql`CREATE UNIQUE INDEX IF NOT EXISTS elysium_migrations_name_unique ON elysium_migrations (name);`;

			const rows: { name: string; applied_at: Date }[] =
				await sql`SELECT name, applied_at FROM elysium_migrations;`;
			const completedMigrations = rows.map((row) => ({
				name: row.name,
				appliedAt: row.applied_at
			}));

			const filesIt = new Bun.Glob('**/*.sql').scan({
				cwd: getMigrationsPath(),
				absolute: true,
				onlyFiles: true
			});

			const files = await Array.fromAsync(filesIt);
			const { pending: sqlFiles, renames } = planMigrations(files, completedMigrations);

			for (const { from, to } of renames) {
				await sql`UPDATE elysium_migrations SET name = ${to} WHERE name = ${from};`;
				this.info(`Migration ${this.bold(from)} is now tracked as ${this.bold(to)}.`);
			}

			if (sqlFiles.length === 0) {
				this.success('No new migrations to apply.');
				return;
			}

			const s = this.spinner(`Running migrations for tenant ${this.bold(this.tenant)}...`);

			const [{ max }]: [{ max?: number }] =
				await sql`SELECT MAX(batch) + 1 AS max FROM elysium_migrations;`;

			const batch = max ?? 0;

			for (const path of sqlFiles) {
				await sql.file(path);
				const [{ name }] =
					await sql`INSERT INTO elysium_migrations (name, batch, applied_at) VALUES (${getMigrationName(path)}, ${batch}, ${new Date()}) RETURNING name;`;
				s.pause(`Migration ${this.bold(name)} applied successfully.`);
			}

			s.complete(`Migrations for tenant ${this.bold(this.tenant)} applied successfully.`);
		});

		await sql.close();
	}

	/**
	 * Checks that the tenant schema exists, or that it may be created. Asks the user when the
	 * schema is missing and a terminal is attached; without one, the schema is created.
	 * @param sql The client.
	 * @returns `false` if the user declined to create the schema.
	 */
	private async ensureSchemaChoice(sql: Bun.SQL): Promise<boolean> {
		const [{ schema_exists }] = await sql`SELECT EXISTS (
			SELECT schema_name
			  FROM information_schema.schemata
			 WHERE schema_name = ${this.tenant}
		) AS schema_exists;`;
		if (schema_exists) return true;

		if (!process.stdin.isTTY) {
			this.info(`Schema ${this.bold(this.tenant)} does not exist. Creating it.`);
			return true;
		}

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
