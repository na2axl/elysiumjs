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

import { Application, Event, Service } from '@elysiumjs/core';
import { getTenancyConfig, getTenancyStrategy } from '@elysiumjs/mnemosyne';
import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';

import * as pkg from '../src';
import {
	Database,
	DrizzleDatabaseCache,
	DrizzleModule,
	DrizzleRLSTenancy,
	DrizzleSchemaTenancy
} from '../src';

const URL = 'postgres://u:p@localhost:5432/db';

const stubClient = () => ({
	options: {},
	connect: mock(async () => {}),
	begin: mock(async (_callback: unknown) => {}),
	close: mock(async () => {})
});

describe('DrizzleModule', () => {
	let app: Awaited<ReturnType<typeof Application.testing>> | undefined;

	afterEach(async () => {
		await app?.shutdown();
		app = undefined;
	});

	it('registers nothing when the package is imported', async () => {
		const once = spyOn(Event, 'once');
		const on = spyOn(Event, 'on');
		await import('../src/index.ts?fresh-import');
		expect(once).not.toHaveBeenCalled();
		expect(on).not.toHaveBeenCalled();
		once.mockRestore();
		on.mockRestore();
		expect(Service.exists('db.connection.default')).toBe(false);
		expect(Service.exists('mnemosyne.tenancy.config')).toBe(false);
		expect(typeof pkg.DrizzleModule.with).toBe('function');
	});

	it('provides connections, the default alias and the schema strategy by default', async () => {
		app = await Application.testing({
			modules: [
				DrizzleModule.with({ default: 'main', connections: { main: { connection: URL } } })
			],
			boot: 'eager'
		});

		expect(Database.connectionExists('main')).toBe(true);
		expect(Database.connectionExists('default')).toBe(true);
		const main = Database.getConnection('main');
		expect(main).toBeDefined();
		expect(Database.getConnection()).toBe(main);
		expect(getTenancyConfig()).toEqual({ mode: 'schema' });
		expect(getTenancyStrategy()).toBeInstanceOf(DrizzleSchemaTenancy);
	});

	it('uses the RLS strategy when tenancy mode is rls', async () => {
		app = await Application.testing({
			modules: [
				DrizzleModule.with({
					connections: { default: { connection: URL } },
					tenancy: { mode: 'rls' }
				})
			],
			boot: 'eager'
		});

		expect(getTenancyConfig()).toEqual({ mode: 'rls' });
		expect(getTenancyStrategy()).toBeInstanceOf(DrizzleRLSTenancy);
	});

	it('provides db.transaction, delegating to Database.transaction', async () => {
		app = await Application.testing({
			modules: [
				DrizzleModule.with({ default: 'main', connections: { main: { connection: URL } } })
			],
			boot: 'eager'
		});
		const transaction = spyOn(Database, 'transaction').mockImplementation((async (
			callback: (tx: unknown) => Promise<unknown>
		) => callback('TX')) as never);

		try {
			const run =
				Service.get<(cb: () => Promise<unknown>, name?: string) => Promise<unknown>>(
					'db.transaction'
				)!;

			expect(await run(async () => 'result')).toBe('result');
			expect(await run(async () => 'named', 'main')).toBe('named');
			expect(transaction).toHaveBeenNthCalledWith(1, expect.any(Function), undefined);
			expect(transaction).toHaveBeenNthCalledWith(2, expect.any(Function), 'main');
		} finally {
			transaction.mockRestore();
		}
	});

	it('rejects a default that is not a declared connection', async () => {
		await expect(
			Application.testing({
				modules: [
					DrizzleModule.with({ default: 'nope', connections: { main: { connection: URL } } })
				]
			})
		).rejects.toThrow(/nope/);
	});

	it('builds a connection with a cache on a lazy boot', async () => {
		app = await Application.testing({
			modules: [
				DrizzleModule.with({
					connections: { default: { connection: URL, cache: { storage: 'memory' } } }
				})
			],
			boot: 'lazy'
		});

		expect(await app.get('db.connection.default')).toBeDefined();
	});

	it('resolves its cache storage on first use', async () => {
		app = await Application.testing({
			modules: [DrizzleModule.with({ connections: { default: { connection: URL } } })],
			boot: 'eager'
		});
		const cache = new DrizzleDatabaseCache('all', 1, 'memory');
		expect(await cache.get('k', ['t'], false, true)).toBeUndefined();
		await cache.put('k', [1], ['t'], false);
		expect(await cache.get('k', ['t'], false, true)).toEqual([1]);
	});

	it('closes only the connections that were created', async () => {
		const used = stubClient();
		const unused = stubClient();
		app = await Application.testing({
			modules: [
				DrizzleModule.with({
					default: 'a',
					connections: { a: { client: used as never }, b: { client: unused as never } }
				})
			],
			boot: 'lazy'
		});
		await app.get('db.connection.default');

		await app.shutdown();
		app = undefined;

		expect(used.close).toHaveBeenCalledTimes(1);
		expect(unused.close).not.toHaveBeenCalled();
	});
});

describe('migration commands', () => {
	const originalExit = process.exit;
	const originalStderr = process.stderr.write;
	const originalStdout = process.stdout.write;
	let errors = '';

	beforeEach(() => {
		errors = '';
		process.exit = mock() as never;
		process.stderr.write = mock((message: string) => {
			errors += message;
			return true;
		}) as never;
		process.stdout.write = mock(() => true) as never;
	});

	let started: Application | undefined;

	afterEach(async () => {
		await started?.kernel.shutdown();
		started = undefined;
		Service.clear();
		process.exit = originalExit;
		process.stderr.write = originalStderr;
		process.stdout.write = originalStdout;
		for (const signal of ['SIGINT', 'SIGTERM'] as const) process.removeAllListeners(signal);
	});

	const makeApp = () => {
		const client = stubClient();
		@Application.register({
			modules: [DrizzleModule.with({ connections: { default: { client: client as never } } })]
		})
		class TestApp extends Application {}
		const app = new TestApp();
		started = app;
		return { app, client };
	};

	it('migration:run finds db.connection.default', async () => {
		const { app, client } = makeApp();
		await app.run(['migration:run', '--tenant', 'public']);

		expect(errors).not.toContain('does not exist');
		expect(client.connect).toHaveBeenCalled();
		expect(client.begin).toHaveBeenCalled();
		expect(Database.connectionExists('default')).toBe(true);
	});

	it('lists the migration commands under NODE_ENV=production', async () => {
		const previous = Bun.env.NODE_ENV;
		Bun.env.NODE_ENV = 'production';
		try {
			const { app } = makeApp();
			await app.run(['list']);
			const names = (app.kernel.graph.collect('commands') as { item: { command: string } }[]).map(
				({ item }) => item.command
			);
			expect(names).toContain('migration:run');
			expect(names).toContain('migration:generate');
		} finally {
			Bun.env.NODE_ENV = previous;
		}
	});
});
