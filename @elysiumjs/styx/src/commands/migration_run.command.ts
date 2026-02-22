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

import { basename } from 'node:path';

import { Command, CommandArgumentType } from '@elysiumjs/core';
import { Database } from '@elysiumjs/mnemosyne-drizzle';
import prompts from 'prompts';
import { alphabetical } from 'radash';

import { BaseCommand } from './base.command';

/**
 * Execute migration files.
 * @author Axel Nana <axel.nana@workbud.com>
 */
@Command.register()
export class MigrationRunCommand extends BaseCommand {
	public static readonly command: string = 'migration:run';
	public static readonly description: string = 'Generates migration files.';

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

		await sql.begin(async (sql) => {
			if (this.fresh) {
				await sql`DROP SCHEMA IF EXISTS ${sql(this.tenant)} CASCADE;`;
				await sql`CREATE SCHEMA ${sql(this.tenant)};`;
			}

			const [{ schema_exists }] = await sql`SELECT EXISTS (
			SELECT schema_name
			  FROM information_schema.schemata
			 WHERE schema_name = ${this.tenant}
		) AS schema_exists;`;

			if (!schema_exists) {
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

				if (answers.create) {
					await sql`CREATE SCHEMA ${sql(this.tenant)};`;
				} else {
					this.error(`Schema ${this.bold(this.tenant)} creation cancelled.`);
					return process.exit(1);
				}
			}

			await sql`SET search_path TO ${sql(this.tenant)};`;

			const [{ table_exists }] = await sql`SELECT EXISTS (
			SELECT *
			  FROM information_schema.tables
			 WHERE table_name = 'elysium_migrations'
			   AND table_schema = ${this.tenant}
		) AS table_exists;`;

			if (!table_exists) {
				await sql`CREATE TABLE elysium_migrations (
				id SERIAL PRIMARY KEY,
				name TEXT NOT NULL,
				batch INTEGER NOT NULL,
				applied_at TIMESTAMP NOT NULL
			);`;
			}

			const migrations: { name: string }[] = await sql`SELECT name FROM elysium_migrations;`;
			const completedMigrations = migrations.map((row) => row.name);

			const filesIt = new Bun.Glob(`./src/database/migrations/**/*.sql`).scan({
				absolute: true,
				onlyFiles: true
			});

			const files = await Array.fromAsync(filesIt);
			const sqlFiles = alphabetical(
				files.filter((file) => !completedMigrations.includes(basename(file))),
				(file) => file
			);

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
					await sql`INSERT INTO elysium_migrations (name, batch, applied_at) VALUES (${basename(path)}, ${batch}, ${new Date()}) RETURNING name;`;
				s.pause(`Migration ${this.bold(name)} applied successfully.`);
			}

			s.complete(`Migrations for tenant ${this.bold(this.tenant)} applied successfully.`);
		});

		await sql.close();
	}
}
