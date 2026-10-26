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

import { exists } from 'node:fs/promises';

import { Command, CommandArgumentType } from '@elysiumjs/core';
import prompts from 'prompts';

import { stripPublicSchema } from '../migrations';
import { getMigrationsPath, getProjectPath } from './project';

/** Lists the SQL files of the migrations directory, as absolute paths. */
const listSqlFiles = async (migrationsPath: string): Promise<string[]> => {
	// The directory does not exist before the first migration is generated.
	if (!(await exists(migrationsPath))) return [];
	return Array.fromAsync(
		new Bun.Glob('**/*.sql').scan({ cwd: migrationsPath, absolute: true, onlyFiles: true })
	);
};

/**
 * Generates migration files.
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
		if (!this.name) {
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
		let schemaPath = `${projectRoot}/src/database/schemas`;
		if (await exists(`${projectRoot}/src/database/schema.ts`)) {
			schemaPath = `${projectRoot}/src/database/schema.ts`;
		}

		const existing = new Set(await listSqlFiles(migrationsPath));

		await Bun.$`bunx --bun drizzle-kit generate --dialect postgresql --schema ${schemaPath} --out ${migrationsPath} --name ${this.name}`;

		// Only the migration generated now is rewritten: earlier ones may have been edited by hand.
		for (const path of await listSqlFiles(migrationsPath)) {
			if (existing.has(path)) continue;
			const file = Bun.file(path);
			await file.write(stripPublicSchema(await file.text()));
		}
	}
}
