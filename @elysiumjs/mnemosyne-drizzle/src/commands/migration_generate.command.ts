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

import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Command, CommandArgumentType } from '@elysiumjs/core';

import { stripPublicSchema } from '../migrations';
import { getMigrationsPath, getProjectPath } from './project';
import { collectAppSchema, renderSchemaEntry } from './schema';

/** Whether a path exists. `node:fs/promises` has no `exists` outside Bun, and this module loads on every runtime. */
const exists = (path: string): Promise<boolean> =>
	access(path).then(
		() => true,
		() => false
	);

/** Lists the SQL files of the migrations directory, as absolute paths. */
const listSqlFiles = async (migrationsPath: string): Promise<string[]> => {
	// The directory does not exist before the first migration is generated.
	if (!(await exists(migrationsPath))) return [];
	return Array.fromAsync(
		new Bun.Glob('**/*.sql').scan({ cwd: migrationsPath, absolute: true, onlyFiles: true })
	);
};

/**
 * Generates migration files. The schema is the one of the app: every table, Postgres schema, enum,
 * sequence, view, role and policy that the project files it loads export, directly or as a value
 * of an exported object (like the tables `moiraiTables()` builds).
 * @author Axel Nana <axel.nana@workbud.com>
 */
@Command.register()
export class MigrationGenerateCommand extends Command {
	public static readonly command: string = 'migration:generate';
	public static readonly description: string = 'Generates migration files.';

	@Command.arg({
		description: 'The name of the migration to create',
		type: CommandArgumentType.STRING
	})
	private name?: string;

	public async run(): Promise<void> {
		if (!this.name && !process.stdin.isTTY) {
			this.error('Give the migration a name with --name when no terminal can answer the prompt.');
			process.exit(1);
		}

		if (!this.name) {
			// Loaded on use: prompts needs Node.js streams, which Workers bundles leave out.
			const { default: prompts } = await import('prompts');
			const answers = await prompts(
				[
					{
						type: 'text',
						name: 'name',
						message: 'Migration Name:',
						initial: 'create_users_table',
						validate(value: string) {
							if (value.length < 1) {
								return 'Migration name cannot be empty';
							}

							return true;
						}
					}
				],
				{
					onCancel: () => {
						this.error('Operation cancelled.');
						process.exit(0);
					}
				}
			);

			this.name = answers.name;
		}

		const projectRoot = getProjectPath();
		const migrationsPath = getMigrationsPath();

		const schema = await collectAppSchema(projectRoot);
		if (schema.length === 0) {
			this.error('No Drizzle table is exported by the files the application loads.');
			process.exit(1);
		}

		const existing = new Set(await listSqlFiles(migrationsPath));

		// Drizzle Kit reads tables from the top-level exports of schema files: one file exports them all.
		const entryDir = await mkdtemp(join(tmpdir(), 'elysium-schema-'));
		const entry = join(entryDir, 'schema.ts');
		try {
			await Bun.write(entry, renderSchemaEntry(schema));
			await Bun.$`bunx --bun drizzle-kit generate --dialect postgresql --schema ${entry} --out ${migrationsPath} --name ${this.name}`.cwd(
				projectRoot
			);
		} finally {
			await rm(entryDir, { recursive: true, force: true });
		}

		// Only the migration generated now is rewritten: earlier ones may have been edited by hand.
		for (const path of await listSqlFiles(migrationsPath)) {
			if (existing.has(path)) continue;
			const file = Bun.file(path);
			await file.write(stripPublicSchema(await file.text()));
		}
	}
}
