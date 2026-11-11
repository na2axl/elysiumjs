// Copyright (c) 2026-present Workbud Technologies Inc. All rights reserved.
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

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { pgEnum, pgSchema, pgSequence, pgTable, pgView, text, uuid } from 'drizzle-orm/pg-core';

import {
	collectAppSchema,
	findSchemaExports,
	isSchemaObject,
	loadedProjectFiles,
	renderSchemaEntry
} from '../src/commands/schema';

describe('isSchemaObject', () => {
	it('accepts what Drizzle Kit generates SQL for', () => {
		const users = pgTable('users', { id: uuid('id').primaryKey() });
		expect(isSchemaObject(users)).toBe(true);
		expect(isSchemaObject(pgSchema('billing'))).toBe(true);
		expect(isSchemaObject(pgEnum('status', ['on', 'off']))).toBe(true);
		expect(isSchemaObject(pgSequence('counter'))).toBe(true);
		expect(isSchemaObject(pgView('active').as((qb) => qb.select().from(users)))).toBe(true);
	});

	it('rejects anything else', () => {
		expect(isSchemaObject(null)).toBe(false);
		expect(isSchemaObject('users')).toBe(false);
		expect(isSchemaObject({ users: pgTable('users', { id: uuid('id') }) })).toBe(false);
		expect(isSchemaObject(class Users {})).toBe(false);
		expect(isSchemaObject(text('name'))).toBe(false);
	});
});

describe('findSchemaExports', () => {
	it('finds direct exports and the tables of an exported object, each once', () => {
		const billing = pgSchema('billing');
		const invoices = billing.table('invoices', { id: uuid('id').primaryKey() });
		const kernel = {
			events: billing.table('events', { id: uuid('id').primaryKey() }),
			label: 'not a table'
		};

		const found = findSchemaExports([
			['/app/schema.ts', { billing, kernel, helper: () => 1 }],
			['/app/invoice.model.ts', { InvoiceTable: invoices, billing }],
			['/app/index.ts', { InvoiceTable: invoices, kernel }]
		]);

		expect(found).toEqual([
			{ file: '/app/schema.ts', path: ['billing'] },
			{ file: '/app/schema.ts', path: ['kernel', 'events'] },
			{ file: '/app/invoice.model.ts', path: ['InvoiceTable'] }
		]);
	});

	it('looks only one level into plain objects', () => {
		const deep = { group: { users: pgTable('users', { id: uuid('id') }) } };
		class Holder {
			users = pgTable('users', { id: uuid('id') });
		}

		expect(findSchemaExports([['/app/a.ts', { deep, holder: new Holder() }]])).toEqual([]);
	});
});

describe('loadedProjectFiles', () => {
	it('keeps the source files of the project outside node_modules, sorted', () => {
		const files = loadedProjectFiles('/app', [
			'/app/src/models/user.model.ts',
			'/app/src/app.ts',
			'/app/node_modules/drizzle-orm/index.js',
			'/app/src/user.test.ts',
			'/app/src/types.d.ts',
			'/app/data.json',
			'/other/src/app.ts',
			'/application/src/app.ts'
		]);

		expect(files).toEqual(['/app/src/app.ts', '/app/src/models/user.model.ts']);
	});
});

describe('renderSchemaEntry', () => {
	it('exports each schema object at the top level', () => {
		const source = renderSchemaEntry([
			{ file: '/app/schema.ts', path: ['billing'] },
			{ file: '/app/schema.ts', path: ['kernel', 'events'] },
			{ file: '/app/user.model.ts', path: ['UserTable'] }
		]);

		expect(source).toBe(
			[
				'import * as m0 from "/app/schema.ts";',
				'import * as m1 from "/app/user.model.ts";',
				'',
				'export const s0 = m0["billing"];',
				'export const s1 = m0["kernel"]["events"];',
				'export const s2 = m1["UserTable"];',
				''
			].join('\n')
		);
	});
});

describe('collectAppSchema', () => {
	let dir: string;

	beforeEach(() => {
		// Inside the package, where the fixtures resolve drizzle-orm.
		dir = realpathSync(mkdtempSync(join(import.meta.dir, '.schema-')));
		mkdirSync(join(dir, 'src', 'billing'), { recursive: true });
		writeFileSync(join(dir, '.elysiumrc'), '{}');
		writeFileSync(
			join(dir, 'src', 'billing', 'schema.ts'),
			[
				"import { pgSchema, uuid } from 'drizzle-orm/pg-core';",
				"export const billing = pgSchema('billing');",
				"export const kernel = { events: billing.table('events', { id: uuid('id').primaryKey() }) };"
			].join('\n')
		);
		writeFileSync(
			join(dir, 'src', 'billing', 'invoice.model.ts'),
			[
				"import { uuid } from 'drizzle-orm/pg-core';",
				"import { billing } from './schema';",
				"export const InvoiceTable = billing.table('invoices', { id: uuid('id').primaryKey() });"
			].join('\n')
		);
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it('writes an entry that exports the tables of the loaded files', async () => {
		await import(join(dir, 'src', 'billing', 'invoice.model.ts'));

		const schema = await collectAppSchema(dir);
		expect(schema).toEqual([
			{ file: join(dir, 'src', 'billing', 'invoice.model.ts'), path: ['InvoiceTable'] },
			{ file: join(dir, 'src', 'billing', 'schema.ts'), path: ['billing'] },
			{ file: join(dir, 'src', 'billing', 'schema.ts'), path: ['kernel', 'events'] }
		]);

		const entry = join(dir, 'entry.ts');
		writeFileSync(entry, renderSchemaEntry(schema));
		const exported: Record<string, unknown> = await import(entry);
		const model = await import(join(dir, 'src', 'billing', 'invoice.model.ts'));
		const base = await import(join(dir, 'src', 'billing', 'schema.ts'));

		const values = Object.values(exported);
		expect(values).toHaveLength(3);
		expect(values[0]).toBe(model.InvoiceTable);
		expect(values[1]).toBe(base.billing);
		expect(values[2]).toBe(base.kernel.events);
	});
});
