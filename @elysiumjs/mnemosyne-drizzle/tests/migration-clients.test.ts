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

import { describe, expect, it } from 'bun:test';
import { sql } from 'drizzle-orm';

import { nodePostgresMigrations, templateClientMigrations } from '../src';

describe('nodePostgresMigrations', () => {
	const pool = () => {
		const log: string[] = [];
		const queryable = (label: string) => ({
			query: async (text: string, values?: unknown[]) => {
				log.push(`${label} ${text}${values ? ` ${JSON.stringify(values)}` : ''}`);
				if (text === 'FAIL') throw new Error('failed');
				return { rows: [{ ok: true }] };
			}
		});
		return {
			log,
			pool: {
				...queryable('pool'),
				connect: async () => ({ ...queryable('tx'), release: () => log.push('release') })
			}
		};
	};

	it('runs statements with values, scripts without, and commits the transaction', async () => {
		const { log, pool: p } = pool();
		const db = nodePostgresMigrations(p);

		const rows = await db.transaction(async (tx) => {
			await tx.script('CREATE TABLE a (id int); CREATE TABLE b (id int);');
			return tx.execute(sql`SELECT ${1} AS one, ${sql.identifier('a')}`);
		});

		expect(rows).toEqual([{ ok: true }]);
		expect(log).toEqual([
			'tx BEGIN',
			'tx CREATE TABLE a (id int); CREATE TABLE b (id int);',
			'tx SELECT $1 AS one, "a" [1]',
			'tx COMMIT',
			'release'
		]);
	});

	it('rolls back and releases the client when the function throws', async () => {
		const { log, pool: p } = pool();

		await expect(nodePostgresMigrations(p).transaction((tx) => tx.script('FAIL'))).rejects.toThrow(
			'failed'
		);

		expect(log).toEqual(['tx BEGIN', 'tx FAIL', 'tx ROLLBACK', 'release']);
	});
});

describe('templateClientMigrations', () => {
	it('runs scripts with the simple protocol and statements with parameters', async () => {
		const log: string[] = [];
		const client = {
			unsafe: (text: string, params?: unknown[]) => ({
				then: (resolve: (rows: unknown[]) => void) => {
					log.push(`extended ${text} ${JSON.stringify(params)}`);
					resolve([{ n: 1 }]);
				},
				simple: async () => {
					log.push(`simple ${text}`);
					return [];
				}
			}),
			begin: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(client)
		};
		const db = templateClientMigrations(client as never);

		await db.script('SELECT 1; SELECT 2;');
		expect(await db.transaction((tx) => tx.execute(sql`SELECT ${'x'}`))).toEqual([{ n: 1 }]);

		expect(log).toEqual(['simple SELECT 1; SELECT 2;', 'extended SELECT $1 ["x"]']);
	});
});
