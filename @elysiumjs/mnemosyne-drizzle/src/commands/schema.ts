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

import { resolve, sep } from 'node:path';

import { is } from 'drizzle-orm';
import {
	isPgEnum,
	isPgSequence,
	PgMaterializedView,
	PgPolicy,
	PgRole,
	PgSchema,
	PgTable,
	PgView
} from 'drizzle-orm/pg-core';

import { bunRequire } from '../bun-require';

/**
 * A schema object found in a project file: the export that holds it, and the keys that lead to it
 * when the export is an object grouping several of them.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type SchemaExport = {
	/** The absolute path of the file. */
	file: string;

	/** The export name, then the keys inside it: `['tables', 'events']` for `tables.events`. */
	path: string[];
};

/** Files that never declare the schema of the app. */
const IGNORED = /(\.d|\.test|\.spec)\.[cm]?[jt]sx?$/;

/** Source files of the project. */
const SOURCE = /\.[cm]?[jt]sx?$/;

/**
 * Whether a value is something Drizzle Kit generates SQL for: a table, a Postgres schema, an
 * enum, a sequence, a view, a role or a policy.
 * @author Axel Nana <axel.nana@workbud.com>
 * @param value The value to check.
 */
export const isSchemaObject = (value: unknown): boolean => {
	if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return false;
	return (
		isPgEnum(value) ||
		isPgSequence(value) ||
		is(value, PgTable) ||
		is(value, PgSchema) ||
		is(value, PgView) ||
		is(value, PgMaterializedView) ||
		is(value, PgRole) ||
		is(value, PgPolicy)
	);
};

/** Whether a value is a plain object, the kind a function returns to group several tables. */
const isPlainObject = (value: unknown): value is Record<string, unknown> => {
	if (value === null || typeof value !== 'object') return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
};

/**
 * Finds the schema objects that the given modules export, each once: exported directly, or as a
 * value of an exported plain object (the tables a function builds for a Postgres schema, for
 * example).
 * @author Axel Nana <axel.nana@workbud.com>
 * @param modules The exports of each file, by absolute path.
 */
export const findSchemaExports = (
	modules: Iterable<[file: string, exports: Record<string, unknown>]>
): SchemaExport[] => {
	const seen = new Set<unknown>();
	const found: SchemaExport[] = [];

	const add = (value: unknown, file: string, path: string[]) => {
		if (seen.has(value)) return;
		seen.add(value);
		found.push({ file, path });
	};

	for (const [file, exports] of modules) {
		for (const [name, value] of Object.entries(exports)) {
			if (isSchemaObject(value)) {
				add(value, file, [name]);
				continue;
			}
			if (!isPlainObject(value)) continue;
			for (const [key, nested] of Object.entries(value)) {
				if (isSchemaObject(nested)) add(nested, file, [name, key]);
			}
		}
	}

	return found;
};

/**
 * Lists the source files of the project that the app has loaded, outside `node_modules`.
 * Importing the app loads every model its modules use, whatever the file name; importing a loaded
 * file again gives back its exports without running it.
 * @author Axel Nana <axel.nana@workbud.com>
 * @param projectPath The root of the project.
 * @param loaded The paths of the loaded files, the keys of the module cache.
 */
export const loadedProjectFiles = (projectPath: string, loaded: Iterable<string>): string[] => {
	const root = resolve(projectPath) + sep;
	return [...loaded]
		.map((file) => resolve(file))
		.filter(
			(path) =>
				path.startsWith(root) &&
				SOURCE.test(path) &&
				!IGNORED.test(path) &&
				!path.includes(`${sep}node_modules${sep}`)
		)
		.sort();
};

/**
 * Finds the schema objects of the app: the ones the project files it loaded export.
 * @author Axel Nana <axel.nana@workbud.com>
 * @param projectPath The root of the project.
 */
export const collectAppSchema = async (projectPath: string): Promise<SchemaExport[]> => {
	// Loaded on use, and only off Bun: this module also loads on Workers, which have no module cache.
	const cache =
		bunRequire()?.cache ?? (await import('node:module')).createRequire(import.meta.url).cache;
	const modules: [string, Record<string, unknown>][] = [];
	for (const file of loadedProjectFiles(projectPath, Object.keys(cache))) {
		modules.push([file, await import(file)]);
	}
	return findSchemaExports(modules);
};

/**
 * Writes the source of a schema file that exports every given schema object at its top level,
 * where Drizzle Kit looks for them.
 * @author Axel Nana <axel.nana@workbud.com>
 * @param exports The schema objects to export.
 */
export const renderSchemaEntry = (exports: SchemaExport[]): string => {
	const files = [...new Set(exports.map(({ file }) => file))];
	const aliases = new Map(files.map((file, i) => [file, `m${i}`]));

	const lines = files.map(
		(file) => `import * as ${aliases.get(file)} from ${JSON.stringify(file)};`
	);
	lines.push('');
	exports.forEach(({ file, path }, i) => {
		const access = path.map((key) => `[${JSON.stringify(key)}]`).join('');
		lines.push(`export const s${i} = ${aliases.get(file)}${access};`);
	});

	return lines.join('\n') + '\n';
};
