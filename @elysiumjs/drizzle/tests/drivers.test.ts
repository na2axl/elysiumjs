// Copyright (c) 2026-present Axel Nana <ax.lnana@outlook.com>. All rights reserved.
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

import type { DrizzleConnection, DrizzleDriver } from '../src';

import { runInvocation } from '@elysiumjs/workers';
import { describe, expect, it, mock } from 'bun:test';
import { Pool } from 'pg';
import postgres from 'postgres';

import { Database } from '../src';
import { bunSql } from '../src/drivers/bun-sql';
import { hyperdrive } from '../src/drivers/hyperdrive';
import { nodePostgres } from '../src/drivers/node-postgres';
import { postgresJs } from '../src/drivers/postgres-js';

describe('drivers', () => {
	it('connects postgres.js and closes it with end()', async () => {
		const client = postgres('postgres://user:pass@localhost:1/db');
		const end = mock(async () => {});
		Object.assign(client, { end });
		const driver = postgresJs({ client });

		const db = driver.connect({});
		expect(db.$client).toBe(client);
		expect(typeof db.select).toBe('function');
		await driver.close(db);
		expect(end).toHaveBeenCalledTimes(1);
	});

	it('connects node-postgres and closes its pool', async () => {
		const pool = new Pool({ connectionString: 'postgres://user:pass@localhost:1/db' });
		const driver = nodePostgres({ client: pool });

		const db = driver.connect({});
		expect(db.$client).toBe(pool);
		await driver.close(db);
		expect(pool.ending).toBe(true);
	});

	it('connects Bun SQL with a client', () => {
		const client = new Bun.SQL('postgres://user:pass@localhost:1/db');
		expect(bunSql({ client }).connect({}).$client).toBe(client);
	});

	it('creates connections through the driver of their props', () => {
		const db = { select() {} } as unknown as DrizzleConnection;
		const driver: DrizzleDriver = { name: 'fake', connect: () => db, close: () => {} };
		expect(Database.createConnection({ driver })).toBe(db);
	});
});

describe('hyperdrive', () => {
	const ctx = () => ({ waitUntil() {}, passThroughOnException() {} });

	it('opens one database per invocation, from the connection string of the binding', async () => {
		const opened: string[] = [];
		const driver = hyperdrive({
			binding: 'HYPERDRIVE',
			driver: (url) => ({
				name: 'fake',
				connect: () => {
					opened.push(url);
					const db = { url, n: opened.length, select: () => `select from ${opened.length}` };
					return db as unknown as DrizzleConnection;
				},
				close: () => {}
			})
		});
		const db = driver.connect({}) as unknown as { n: number; select(): string };
		const env = { HYPERDRIVE: { connectionString: 'postgres://hyperdrive' } };

		const first = runInvocation({ env, ctx: ctx() }, () => [db.n, db.n, db.select()]);
		const second = runInvocation({ env, ctx: ctx() }, () => db.n);

		expect(first).toEqual([1, 1, 'select from 1']);
		expect(second).toBe(2);
		expect(opened).toEqual(['postgres://hyperdrive', 'postgres://hyperdrive']);
	});
});
