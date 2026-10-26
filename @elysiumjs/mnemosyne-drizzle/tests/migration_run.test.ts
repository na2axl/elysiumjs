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
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Application, Service } from '@elysiumjs/core';
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import prompts from 'prompts';

import { DrizzleModule } from '../src';

type Statement = { tx: boolean; text: string };

/**
 * A stand-in for `Bun.SQL` supporting what `migration:run` uses: tagged queries, `sql(name)`
 * identifiers, `begin`, `file`, `connect` and `close`.
 * @param schemaExists Whether the tenant schema exists.
 */
const fakeBunSql = (schemaExists: boolean) => {
	const statements: Statement[] = [];
	const files: string[] = [];

	const respond = (text: string) => {
		if (text.includes('information_schema.schemata')) return [{ schema_exists: schemaExists }];
		if (text.includes('information_schema.tables')) return [{ table_exists: false }];
		if (text.startsWith('SELECT MAX(batch)')) return [{ max: null }];
		if (text.startsWith('INSERT INTO elysium_migrations')) return [{ name: 'migration' }];
		return [];
	};

	const make = (tx: boolean): any => {
		const sql: any = (strings: TemplateStringsArray | string, ...values: unknown[]) => {
			if (typeof strings === 'string') return { identifier: strings };
			const text = strings
				.reduce(
					(acc, part, i) =>
						acc +
						part +
						(i < values.length
							? typeof values[i] === 'object' && values[i] !== null && 'identifier' in values[i]!
								? `"${(values[i] as { identifier: string }).identifier}"`
								: `<${String(values[i])}>`
							: ''),
					''
				)
				.replace(/\s+/g, ' ')
				.trim();
			statements.push({ tx, text });
			return Promise.resolve(respond(text));
		};
		sql.file = async (path: string) => {
			files.push(path);
			statements.push({ tx, text: `FILE ${path}` });
			return [];
		};
		return sql;
	};

	const client = make(false);
	client.options = {};
	client.connect = mock(async () => {});
	client.close = mock(async () => {});
	client.begin = mock(async (callback: (sql: unknown) => Promise<unknown>) => {
		statements.push({ tx: false, text: 'BEGIN' });
		const result = await callback(make(true));
		statements.push({ tx: false, text: 'COMMIT' });
		return result;
	});

	return { client, statements, files };
};

describe('migration:run', () => {
	const originalExit = process.exit;
	const originalStdout = process.stdout.write;
	const originalStderr = process.stderr.write;
	const originalCwd = process.cwd();
	const originalTTY = process.stdin.isTTY;
	const originalClearLine = process.stdout.clearLine;
	const originalCursorTo = process.stdout.cursorTo;
	let project: string;
	let output = '';
	let started: Application | undefined;

	beforeEach(() => {
		output = '';
		process.exit = mock() as never;
		process.stdout.write = mock((message: string) => {
			output += message;
			return true;
		}) as never;
		process.stderr.write = mock((message: string) => {
			output += message;
			return true;
		}) as never;
		// The spinner moves the cursor, which a non-TTY stdout cannot do.
		Object.assign(process.stdout, { clearLine: mock(() => true), cursorTo: mock(() => true) });

		project = realpathSync(mkdtempSync(join(tmpdir(), 'elysium-migrations-')));
		writeFileSync(join(project, '.elysiumrc'), '{}');
		mkdirSync(join(project, 'src/database/migrations'), { recursive: true });
		mkdirSync(join(project, 'src/modules'), { recursive: true });
		writeFileSync(join(project, 'src/database/migrations/0001_init.sql'), 'SELECT 1;');
		// Run from a subdirectory: the migrations are still found from the project root.
		process.chdir(join(project, 'src/modules'));
	});

	afterEach(async () => {
		await started?.kernel.shutdown();
		started = undefined;
		Service.clear();
		process.chdir(originalCwd);
		rmSync(project, { recursive: true, force: true });
		process.exit = originalExit;
		process.stdout.write = originalStdout;
		process.stderr.write = originalStderr;
		process.stdin.isTTY = originalTTY;
		Object.assign(process.stdout, { clearLine: originalClearLine, cursorTo: originalCursorTo });
		for (const signal of ['SIGINT', 'SIGTERM'] as const) process.removeAllListeners(signal);
	});

	const run = async (
		schemaExists: boolean,
		args: string[] = [],
		tenant = 'acme',
		setup: (fake: ReturnType<typeof fakeBunSql>) => void = () => {}
	) => {
		const fake = fakeBunSql(schemaExists);
		setup(fake);
		@Application.register({
			modules: [DrizzleModule.with({ connections: { default: { client: fake.client as never } } })]
		})
		class TestApp extends Application {}
		const app = new TestApp();
		started = app;
		await app.run(['migration:run', '--tenant', tenant, ...args]);
		return fake;
	};

	it('locks the migrations of the tenant before anything else in the transaction', async () => {
		const { statements } = await run(true);

		const inTransaction = statements.filter(({ tx }) => tx).map(({ text }) => text);
		expect(inTransaction[0]).toBe(
			'SELECT pg_advisory_xact_lock(hashtext(<elysium_migrations:acme>))'
		);
	});

	it('scopes the search path to the transaction', async () => {
		const { statements } = await run(true);

		const texts = statements.map(({ text }) => text);
		expect(texts).toContain('SET LOCAL search_path TO "acme"');
		expect(texts.some((text) => /^SET search_path/.test(text))).toBe(false);
	});

	it('makes migration names unique, including in existing tables', async () => {
		const { statements } = await run(true);

		expect(statements.map(({ text }) => text)).toContain(
			'CREATE UNIQUE INDEX IF NOT EXISTS elysium_migrations_name_unique ON elysium_migrations (name);'
		);
	});

	it('reads the migrations from the project root', async () => {
		const { files } = await run(true);

		expect(files).toEqual([join(project, 'src/database/migrations/0001_init.sql')]);
	});

	it('asks to create a missing schema before opening the transaction', async () => {
		process.stdin.isTTY = true;
		prompts.inject([true]);

		const { statements } = await run(false);

		const texts = statements.map(({ text }) => text);
		const check = texts.findIndex((text) => text.includes('information_schema.schemata'));
		expect(check).toBeGreaterThanOrEqual(0);
		expect(check).toBeLessThan(texts.indexOf('BEGIN'));
		expect(texts).toContain('CREATE SCHEMA IF NOT EXISTS "acme";');
	});

	it('stops without opening a transaction when the schema creation is declined', async () => {
		process.stdin.isTTY = true;
		prompts.inject([false]);

		const { statements, client } = await run(false);

		expect(client.begin).not.toHaveBeenCalled();
		expect(statements.map(({ text }) => text)).not.toContain('CREATE SCHEMA IF NOT EXISTS "acme";');
		expect(process.exit).toHaveBeenCalledWith(1);
	});

	it('fails without a TTY when the schema is missing and --create-schema is not given', async () => {
		process.stdin.isTTY = false;

		const { statements, client } = await run(false);

		expect(client.begin).not.toHaveBeenCalled();
		expect(statements.map(({ text }) => text)).not.toContain('CREATE SCHEMA IF NOT EXISTS "acme";');
		expect(output).toContain('--create-schema');
		expect(process.exit).toHaveBeenCalledWith(1);
		expect(client.close).toHaveBeenCalled();
	});

	it('creates a missing schema without prompting with --create-schema', async () => {
		process.stdin.isTTY = true;
		// Would decline if the user were asked.
		prompts.inject([false]);

		const { statements } = await run(false, ['--create-schema']);

		expect(statements.map(({ text }) => text)).toContain('CREATE SCHEMA IF NOT EXISTS "acme";');
		expect(process.exit).not.toHaveBeenCalledWith(1);
	});

	it.each(['a"b', 'pg_catalog', 'information_schema', 'x'.repeat(64)])(
		'rejects the malformed tenant %p before connecting',
		async (tenant) => {
			const { client, statements } = await run(true, [], tenant);

			expect(client.connect).not.toHaveBeenCalled();
			expect(statements).toEqual([]);
			expect(output).toContain('Invalid tenant');
			expect(process.exit).toHaveBeenCalledWith(1);
		}
	);

	it('closes the client when the transaction fails', async () => {
		let client: ReturnType<typeof fakeBunSql>['client'];

		await run(true, [], 'acme', (fake) => {
			client = fake.client;
			fake.client.begin = mock(async () => {
				throw new Error('connection lost');
			});
		}).catch(() => {});

		expect(client!.begin).toHaveBeenCalled();
		expect(client!.close).toHaveBeenCalled();
	});
});
