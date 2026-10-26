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

/** Characters that can appear in an unquoted identifier. */
const IDENTIFIER_CHAR = /[A-Za-z0-9_$]/;

/** The public schema qualifier Drizzle Kit writes before identifiers. */
const PUBLIC_QUALIFIER = '"public".';

/** Finds the end of a quoted token (`'...'` or `"..."`), where a doubled quote is escaped. */
const endOfQuoted = (sql: string, start: number, quote: string, backslash: boolean): number => {
	let i = start + 1;
	while (i < sql.length) {
		if (backslash && sql[i] === '\\') i += 2;
		else if (sql[i] !== quote) i++;
		else if (sql[i + 1] === quote) i += 2;
		else return i + 1;
	}
	return sql.length;
};

/** Finds the end of the token starting at `i` that must be kept as is, or -1 if there is none. */
const endOfVerbatim = (sql: string, i: number): number => {
	const previous = sql[i - 1] ?? '';
	if (sql.startsWith('--', i)) {
		const end = sql.indexOf('\n', i);
		return end < 0 ? sql.length : end;
	}
	if (sql.startsWith('/*', i)) {
		const end = sql.indexOf('*/', i + 2);
		return end < 0 ? sql.length : end + 2;
	}
	if (sql[i] === "'") {
		// E'...' strings also escape with backslashes.
		const escape = /[Ee]/.test(previous) && !IDENTIFIER_CHAR.test(sql[i - 2] ?? '');
		return endOfQuoted(sql, i, "'", escape);
	}
	if (sql[i] === '$' && !IDENTIFIER_CHAR.test(previous)) {
		const tag = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i, i + 64))?.[0];
		if (tag) {
			const end = sql.indexOf(tag, i + tag.length);
			return end < 0 ? sql.length : end + tag.length;
		}
	}
	return -1;
};

/**
 * Removes the `"public".` qualifier Drizzle Kit writes before identifiers, so that a migration
 * runs in the schema selected by the `search_path` (the tenant schema).
 *
 * Only identifier qualifiers are changed: string literals, dollar-quoted bodies (functions, `DO`
 * blocks), comments and other quoted identifiers are kept as is. Qualifiers inside a `DO` block
 * are therefore kept: such blocks are not rewritten, since their contents are not parsed here.
 * @author Axel Nana <axel.nana@workbud.com>
 * @param sql The migration SQL.
 * @returns The SQL without the public schema qualifiers.
 */
export const stripPublicSchema = (sql: string): string => {
	let output = '';
	let i = 0;
	while (i < sql.length) {
		const verbatim = endOfVerbatim(sql, i);
		if (verbatim >= 0) {
			output += sql.slice(i, verbatim);
			i = verbatim;
		} else if (sql.startsWith(PUBLIC_QUALIFIER, i) && sql[i + PUBLIC_QUALIFIER.length] === '"') {
			i += PUBLIC_QUALIFIER.length;
		} else if (sql[i] === '"') {
			const end = endOfQuoted(sql, i, '"', false);
			output += sql.slice(i, end);
			i = end;
		} else {
			output += sql[i];
			i++;
		}
	}
	return output;
};
