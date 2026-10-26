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

import type { CacheInterface } from '@elysiumjs/mnemosyne';

import { Application } from '@elysiumjs/core';
import { Cache, MnemosyneModule, withTenant } from '@elysiumjs/mnemosyne';
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	setSystemTime,
	spyOn
} from 'bun:test';
import { eq } from 'drizzle-orm';
import * as d from 'drizzle-orm/pg-core';

import { Database, DEFAULT_CACHE_TTL, DrizzleDatabaseCache } from '../src/database';
import { fakeSql } from './fake-sql';

const users = d.pgTable('cache_users', { id: d.integer().primaryKey(), name: d.text() });
const posts = d.pgTable('cache_posts', { id: d.integer().primaryKey() });

let app: Awaited<ReturnType<typeof Application.testing>>;
let storage: Omit<CacheInterface, 'tags'>;

beforeAll(async () => {
	app = await Application.testing({
		modules: [
			MnemosyneModule.with({ cache: { redis: false, memory: { ttl: 60_000, lruSize: 5000 } } })
		],
		boot: 'eager'
	});
	storage = Cache.memory.tags('database');
});

afterAll(async () => {
	await app.shutdown();
});

beforeEach(async () => {
	await storage.clear();
});

/** Runs a cache lookup the way Drizzle does: `get`, then `put` on a miss. */
const query = async (
	cache: DrizzleDatabaseCache,
	key: string,
	tables: string[],
	run: () => unknown[],
	options: { isTag?: boolean; autoInvalidate?: boolean; config?: object } = {}
) => {
	const { isTag = false, autoInvalidate = true, config } = options;
	const cached = await cache.get(key, tables, isTag, autoInvalidate);
	if (cached !== undefined) return cached;
	const rows = run();
	await cache.put(key, rows, autoInvalidate ? tables : [], isTag, config as never);
	return rows;
};

describe('DrizzleDatabaseCache', () => {
	describe('tenant isolation', () => {
		it('never serves the rows cached for one tenant to another', async () => {
			const cache = new DrizzleDatabaseCache('all', 60, 'memory');

			await withTenant('a', () => query(cache, 'k', ['users'], () => [{ tenant: 'a' }]));

			expect(await withTenant('b', () => cache.get('k', ['users'], false, true))).toBeUndefined();
			expect(await cache.get('k', ['users'], false, true)).toBeUndefined();
			expect(await withTenant('a', () => cache.get('k', ['users'], false, true))).toEqual([
				{ tenant: 'a' }
			]);
		});

		it('invalidates a tag for the current tenant only', async () => {
			const cache = new DrizzleDatabaseCache('all', 60, 'memory');
			const tagged = { isTag: true, autoInvalidate: false };

			await withTenant('a', () => query(cache, 'list', [], () => ['a'], tagged));
			await withTenant('b', () => query(cache, 'list', [], () => ['b'], tagged));

			await withTenant('a', () => cache.onMutate({ tags: 'list' }));

			expect(await withTenant('a', () => cache.get('list', [], true, false))).toBeUndefined();
			expect(await withTenant('b', () => cache.get('list', [], true, false))).toEqual(['b']);
		});
	});

	describe('invalidation', () => {
		it('is seen by every instance sharing the cache store', async () => {
			const first = new DrizzleDatabaseCache('all', 60, 'memory');
			const second = new DrizzleDatabaseCache('all', 60, 'memory');

			await query(first, 'k', ['users'], () => [1]);
			expect(await second.get('k', ['users'], false, true)).toEqual([1]);

			await second.onMutate({ tables: 'users' });

			expect(await first.get('k', ['users'], false, true)).toBeUndefined();
		});

		it('applies to every tenant, since a mutation can change rows other tenants read', async () => {
			const cache = new DrizzleDatabaseCache('all', 60, 'memory');
			await withTenant('a', () => query(cache, 'k', ['cache_users'], () => [1]));

			await withTenant('b', () => cache.onMutate({ tables: [users] }));

			expect(
				await withTenant('a', () => cache.get('k', ['cache_users'], false, true))
			).toBeUndefined();
		});

		it('only drops the queries using the mutated tables', async () => {
			const cache = new DrizzleDatabaseCache('all', 60, 'memory');
			await query(cache, 'u', ['users'], () => ['u']);
			await query(cache, 'p', ['posts'], () => ['p']);

			await cache.onMutate({ tables: ['users'] });

			expect(await cache.get('u', ['users'], false, true)).toBeUndefined();
			expect(await cache.get('p', ['posts'], false, true)).toEqual(['p']);
		});

		it('does not store rows read before a mutation as current', async () => {
			const cache = new DrizzleDatabaseCache('all', 60, 'memory');

			expect(await cache.get('k', ['users'], false, true)).toBeUndefined();
			// A mutation lands while the query runs: the rows read may predate it.
			await cache.onMutate({ tables: ['users'] });
			await cache.put('k', ['stale'], ['users'], false);

			expect(await cache.get('k', ['users'], false, true)).toBeUndefined();
		});

		it.each([
			['the newer query', 'puts first'],
			['the older query', 'puts first']
		])('never stores rows read before a mutation when %s %s', async (first) => {
			const cache = new DrizzleDatabaseCache('all', 60, 'memory');

			// A slow query misses before a mutation, a fast one after it.
			await cache.get('k', ['users'], false, true);
			await cache.onMutate({ tables: ['users'] });
			await cache.get('k', ['users'], false, true);

			const puts = first === 'the newer query' ? [['new'], ['old']] : [['old'], ['new']];
			for (const rows of puts) await cache.put('k', rows, ['users'], false);

			expect(await cache.get('k', ['users'], false, true)).not.toEqual(['old']);
		});

		it('stores the rows of concurrent queries read at the same versions', async () => {
			const cache = new DrizzleDatabaseCache('all', 60, 'memory');

			await cache.get('k', ['users'], false, true);
			await cache.get('k', ['users'], false, true);
			await cache.put('k', ['rows'], ['users'], false);
			await cache.put('k', ['rows'], ['users'], false);

			expect(await cache.get('k', ['users'], false, true)).toEqual(['rows']);
		});

		it('forgets the misses of failed queries once they are older than the TTL', async () => {
			const cache = new DrizzleDatabaseCache('all', 5, 'memory');

			try {
				// The query fails: `put` is never called for this miss.
				await cache.get('k', ['users'], false, true);
				await cache.onMutate({ tables: ['users'] });
				setSystemTime(new Date(Date.now() + 6000));

				await query(cache, 'k', ['users'], () => ['rows']);
			} finally {
				setSystemTime();
			}

			expect(await cache.get('k', ['users'], false, true)).toEqual(['rows']);
		});

		it('bounds the number of keys waiting for their result', async () => {
			const cache = new DrizzleDatabaseCache('all', 60, 'memory');

			// Failed queries on many keys, the first one among them.
			for (let i = 0; i <= 1000; i++) await cache.get(`k${i}`, ['users'], false, true);
			await cache.onMutate({ tables: ['users'] });

			await query(cache, 'k0', ['users'], () => ['rows']);

			expect(await cache.get('k0', ['users'], false, true)).toEqual(['rows']);
		});

		it('keeps queries that opted out of auto invalidation', async () => {
			const cache = new DrizzleDatabaseCache('all', 60, 'memory');
			await query(cache, 'k', ['users'], () => [1], { autoInvalidate: false });

			await cache.onMutate({ tables: ['users'] });

			expect(await cache.get('k', ['users'], false, false)).toEqual([1]);
		});

		it('keeps no per-query bookkeeping in the process', async () => {
			const cache = new DrizzleDatabaseCache('all', 60, 'memory');

			for (let i = 0; i < 50; i++) await query(cache, `k${i}`, ['users'], () => [i]);

			expect(Object.keys(cache)).not.toContain('usedTablesPerKey');
			expect(JSON.stringify(cache)).not.toContain('k49');
		});
	});

	describe('expiry', () => {
		let set: ReturnType<typeof spyOn>;
		let mset: ReturnType<typeof spyOn>;

		beforeEach(() => {
			set = spyOn(storage, 'set');
			mset = spyOn(storage, 'mset');
		});

		afterEach(() => {
			set.mockRestore();
			mset.mockRestore();
		});

		const entryTtl = () => set.mock.calls.at(-1)![2] as number;

		it(`defaults to ${DEFAULT_CACHE_TTL} seconds`, async () => {
			await query(new DrizzleDatabaseCache('all', undefined, 'memory'), 'k', ['users'], () => [1]);

			expect(DEFAULT_CACHE_TTL).toBe(60);
			expect(entryTtl()).toBe(60_000);
		});

		it('honours the configured TTL, in seconds', async () => {
			await query(new DrizzleDatabaseCache('all', 5, 'memory'), 'k', ['users'], () => [1]);

			expect(entryTtl()).toBe(5000);
		});

		it.each([
			[{ ex: 2 }, 2000],
			[{ px: 1500 }, 1500]
		])('honours %p', async (config, ttl) => {
			await query(new DrizzleDatabaseCache('all', 60, 'memory'), 'k', ['users'], () => [1], {
				config
			});

			expect(entryTtl()).toBe(ttl);
		});

		it('honours absolute expiry times', async () => {
			const cache = new DrizzleDatabaseCache('all', 60, 'memory');

			await query(cache, 'a', [], () => [1], { config: { pxat: Date.now() + 3000 } });
			expect(entryTtl()).toBeWithin(2900, 3001);

			await query(cache, 'b', [], () => [1], {
				config: { exat: Math.floor(Date.now() / 1000) + 4 }
			});
			expect(entryTtl()).toBeWithin(2900, 4001);
		});

		it('does not cache rows whose expiry time has passed', async () => {
			const cache = new DrizzleDatabaseCache('all', 60, 'memory');

			await query(cache, 'k', [], () => [1], { config: { pxat: Date.now() - 1 } });

			expect(set).not.toHaveBeenCalled();
			expect(await cache.get('k', [], false, true)).toBeUndefined();
		});

		it('keeps the remaining TTL of an entry with keepTtl', async () => {
			const cache = new DrizzleDatabaseCache('all', 60, 'memory');
			await query(cache, 'k', ['users'], () => [1], { config: { px: 5000 } });
			await cache.onMutate({ tables: ['users'] });

			await query(cache, 'k', ['users'], () => [2], { config: { keepTtl: true } });

			expect(entryTtl()).toBeWithin(4000, 5001);
		});

		it('uses the default TTL with keepTtl when there is no entry', async () => {
			await query(new DrizzleDatabaseCache('all', 7, 'memory'), 'k', [], () => [1], {
				config: { keepTtl: true }
			});

			expect(entryTtl()).toBe(7000);
		});

		it('writes every key with a TTL', async () => {
			const cache = new DrizzleDatabaseCache('all', 60, 'memory');
			await query(cache, 'k', ['users', 'posts'], () => [1]);
			await cache.onMutate({ tables: ['users'] });

			for (const [, , ttl] of set.mock.calls) expect(ttl).toBeGreaterThan(0);
			for (const [entries] of mset.mock.calls) {
				for (const { ttl } of entries as { ttl?: number }[]) expect(ttl).toBeGreaterThan(0);
			}
			expect(mset).toHaveBeenCalled();
		});
	});

	describe('transactions', () => {
		const setup = () => {
			const fake = fakeSql((sql) => (sql.startsWith('select') ? [{ id: 1, name: 'Ada' }] : []));
			const db = Database.createConnection({
				client: fake.client as never,
				cache: { strategy: 'all', storage: 'memory' }
			});
			const reads = () => fake.log.filter(({ query }) => query.startsWith('select'));
			return { db, fake, reads };
		};

		it('serves repeated reads from the cache outside transactions', async () => {
			const { db, reads } = setup();

			await db.select().from(users);
			await db.select().from(users);

			expect(reads()).toHaveLength(1);
		});

		it('neither reads nor writes the cache inside a transaction', async () => {
			const { db, reads } = setup();
			await db.select().from(users);

			await db.transaction(async (tx) => {
				await tx.select().from(users);
				await tx.select().from(posts);
			});
			await db.select().from(posts);

			expect(reads().map(({ client }) => client)).toEqual(['root', 'tx', 'tx', 'root']);
		});

		it('invalidates the tables mutated in a transaction after it commits', async () => {
			const { db, fake, reads } = setup();
			await db.select().from(users);

			// Records the last statement sent when the cache bumps the table versions.
			const bumps: string[] = [];
			const original = storage.mset.bind(storage);
			const spy = spyOn(storage, 'mset').mockImplementation(async (entries) => {
				bumps.push(fake.log.at(-1)!.query);
				return original(entries);
			});

			try {
				await db.transaction(async (tx) => {
					await tx.update(users).set({ name: 'Grace' }).where(eq(users.id, 1));
				});
			} finally {
				spy.mockRestore();
			}

			expect(bumps).toEqual(['COMMIT']);
			await db.select().from(users);
			expect(reads().map(({ client }) => client)).toEqual(['root', 'root']);
		});

		it('does not invalidate after a rollback', async () => {
			const { db } = setup();
			const mset = spyOn(storage, 'mset');

			try {
				await db
					.transaction(async (tx) => {
						await tx.update(users).set({ name: 'Grace' }).where(eq(users.id, 1));
						throw new Error('rollback');
					})
					.catch(() => {});

				expect(mset).not.toHaveBeenCalled();
			} finally {
				mset.mockRestore();
			}
		});
	});
});
