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

import { basename, dirname } from 'node:path';

/** The migrations to run, and the applied records to rename to their new names. */
export type MigrationPlan = {
	pending: string[];
	renames: { from: string; to: string }[];
};

const FOLDER_MIGRATION_FILE = 'migration.sql';

/**
 * Gets the name under which a migration file is tracked. Drizzle Kit 1.0 stores each migration
 * as `<folder>/migration.sql`, in which case the folder name identifies the migration.
 * @author Axel Nana <axel.nana@workbud.com>
 * @param path The path of the migration file.
 */
export const getMigrationName = (path: string): string =>
	basename(path) === FOLDER_MIGRATION_FILE ? basename(dirname(path)) : basename(path);

/** Drops the `.sql` extension and the leading index or timestamp: `0001_users.sql` → `users`. */
const descriptiveName = (name: string): string =>
	name
		.replace(/\.sql$/, '')
		.split('_')
		.slice(1)
		.join('_');

/**
 * Decides which migration files to run.
 *
 * `drizzle-kit up` moves each flat `<prefix>_<name>.sql` file into a
 * `<timestamp>_<name>/migration.sql` folder, with a timestamp that differs from the old
 * prefix. An applied record whose flat file is gone is matched, in order, to the folder with
 * the same `<name>`; that folder is not run again and the record is renamed.
 * @author Axel Nana <axel.nana@workbud.com>
 * @param files The paths of the migration files.
 * @param applied The names of the applied migrations.
 */
export const planMigrations = (files: string[], applied: string[]): MigrationPlan => {
	const appliedNames = new Set(applied);
	const fileNames = new Set(files.map(getMigrationName));

	const moved = new Map<string, string[]>();
	for (const name of [...applied].sort()) {
		if (!name.endsWith('.sql') || fileNames.has(name)) continue;
		const key = descriptiveName(name);
		moved.set(key, [...(moved.get(key) ?? []), name]);
	}

	const plan: MigrationPlan = { pending: [], renames: [] };
	for (const file of [...files].sort()) {
		const name = getMigrationName(file);
		if (appliedNames.has(name)) continue;

		const from =
			basename(file) === FOLDER_MIGRATION_FILE
				? moved.get(descriptiveName(name))?.shift()
				: undefined;
		if (from) plan.renames.push({ from, to: name });
		else plan.pending.push(file);
	}
	return plan;
};
