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

/** A migration recorded as applied in `elysium_migrations`. */
export type AppliedMigration = {
	name: string;
	appliedAt: Date;
};

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

/** Reads the UTC `YYYYMMDDHHmmss` timestamp that starts a Drizzle Kit 1.0 folder name. */
const folderTime = (name: string): number | undefined => {
	const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(name);
	return match
		? Date.UTC(+match[1]!, +match[2]! - 1, +match[3]!, +match[4]!, +match[5]!, +match[6]!)
		: undefined;
};

/**
 * Decides which migration files to run.
 *
 * `drizzle-kit up` moves each flat `<prefix>_<name>.sql` file into a
 * `<timestamp>_<name>/migration.sql` folder, where the timestamp is when the migration was
 * generated. An applied record whose flat file is gone is matched, in order, to a folder with
 * the same `<name>` generated before the record was applied; that folder is not run again and
 * the record is renamed. Folders generated later are new migrations and run.
 * @author Axel Nana <axel.nana@workbud.com>
 * @param files The paths of the migration files.
 * @param applied The applied migrations.
 */
export const planMigrations = (files: string[], applied: AppliedMigration[]): MigrationPlan => {
	const appliedNames = new Set(applied.map(({ name }) => name));
	const fileNames = new Set(files.map(getMigrationName));

	const moved = new Map<string, AppliedMigration[]>();
	for (const record of [...applied].sort((a, b) => a.name.localeCompare(b.name))) {
		if (!record.name.endsWith('.sql') || fileNames.has(record.name)) continue;
		const key = descriptiveName(record.name);
		moved.set(key, [...(moved.get(key) ?? []), record]);
	}

	const plan: MigrationPlan = { pending: [], renames: [] };
	for (const file of [...files].sort()) {
		const name = getMigrationName(file);
		if (appliedNames.has(name)) continue;

		const from = basename(file) === FOLDER_MIGRATION_FILE ? takeMoved(moved, name) : undefined;
		if (from) plan.renames.push({ from, to: name });
		else plan.pending.push(file);
	}
	return plan;
};

/** Removes and returns the first moved record that the folder `name` can be the new home of. */
const takeMoved = (moved: Map<string, AppliedMigration[]>, name: string): string | undefined => {
	const records = moved.get(descriptiveName(name));
	const generatedAt = folderTime(name);
	const index =
		records?.findIndex(
			({ appliedAt }) => generatedAt === undefined || generatedAt <= appliedAt.getTime()
		) ?? -1;
	return index < 0 ? undefined : records!.splice(index, 1)[0]!.name;
};
