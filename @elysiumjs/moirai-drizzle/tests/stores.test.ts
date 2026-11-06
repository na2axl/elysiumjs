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

import { Service } from '@elysiumjs/core';
import { IdempotencyConflictError } from '@elysiumjs/moirai';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { getTableConfig } from 'drizzle-orm/pg-core';

import {
	DrizzleIdempotencyStore,
	DrizzleInboxStore,
	DrizzleOutboxStore,
	moiraiTables,
	PgAdvisoryLock
} from '../src';
import { fakeConnection } from './fake-sql';

describe('moirai stores', () => {
	const tables = moiraiTables('billing');
	let fake: ReturnType<typeof fakeConnection>;
	let answer: (query: string) => Record<string, unknown>[];

	beforeEach(() => {
		answer = () => [];
		fake = fakeConnection((query) => answer(query));
		Service.instance('db.connection.default', fake.connection);
	});

	afterEach(() => {
		Service.remove('db.connection.default');
	});

	const queries = () => fake.log.map(({ query }) => query);

	it('builds the tables in a schema, with the due index of the outbox', () => {
		const outbox = getTableConfig(tables.outbox);
		expect(outbox.schema).toBe('billing');
		expect(outbox.indexes.map((i) => i.config.name)).toEqual(['outbox_due_idx']);
		expect(getTableConfig(tables.inbox).primaryKeys).toHaveLength(1);
		expect(getTableConfig(moiraiTables().idempotencyKeys).schema).toBeUndefined();
	});

	it('reads and writes idempotency records, and reports a taken key as a conflict', async () => {
		const store = new DrizzleIdempotencyStore({ table: tables.idempotencyKeys });
		answer = (query) =>
			query.startsWith('select')
				? [{ key: 'k', command: 'pay', request_hash: 'h', response: null, created_at: new Date(0) }]
				: [];

		expect(await store.get('k')).toMatchObject({
			key: 'k',
			command: 'pay',
			requestHash: 'h',
			response: null
		});
		expect(queries()[0]).toContain(
			'from "billing"."idempotency_keys" where "billing"."idempotency_keys"."key" = $1'
		);

		await store.put({
			key: 'k2',
			command: 'pay',
			requestHash: 'h',
			response: { ok: true },
			createdAt: new Date(0)
		});
		expect(queries()[1]).toStartWith('insert into "billing"."idempotency_keys"');

		answer = () => {
			throw Object.assign(new Error('duplicate key'), { code: '23505' });
		};
		expect(
			store.put({
				key: 'k',
				command: 'pay',
				requestHash: 'h',
				response: null,
				createdAt: new Date(0)
			})
		).rejects.toBeInstanceOf(IdempotencyConflictError);
	});

	it('claims due outbox rows with skip locked, filtered, and marks them', async () => {
		const store = new DrizzleOutboxStore({ table: tables.outbox });
		expect(await store.claimDue(new Date(0), 10, { kinds: [] })).toEqual([]);
		expect(fake.log).toEqual([]);

		await store.claimDue(new Date(0), 10, { kinds: ['mail'], ids: ['a'] });
		const claim = queries()[0]!;
		expect(claim).toContain('"dispatched_at" is null');
		expect(claim).toContain('"dead_at" is null');
		expect(claim).toContain('"kind" in ($2)');
		expect(claim).toContain('"id" in ($3)');
		expect(claim).toEndWith(
			'order by "billing"."outbox"."available_at" asc limit $4 for update skip locked'
		);

		await store.insert([]);
		await store.insert([
			{
				id: '0190',
				kind: 'mail',
				payload: {},
				createdAt: new Date(0),
				availableAt: new Date(0),
				attempts: 0,
				lastError: null,
				dispatchedAt: null,
				deadAt: null
			}
		]);
		await store.markDispatched('0190', new Date(0));
		await store.markFailed('0190', { attempts: 1, lastError: 'x', availableAt: new Date(0) });
		await store.markDead('0190', { attempts: 2, lastError: 'x', deadAt: new Date(0) });
		expect(queries().slice(1)).toEqual([
			expect.stringMatching(/^insert into "billing"."outbox"/),
			expect.stringMatching(/^update "billing"."outbox" set "dispatched_at" = \$1 where/),
			expect.stringMatching(
				/^update "billing"."outbox" set "available_at" = \$1, "attempts" = \$2, "last_error" = \$3/
			),
			expect.stringMatching(
				/^update "billing"."outbox" set "attempts" = \$1, "last_error" = \$2, "dead_at" = \$3/
			)
		]);
	});

	it('records inbox messages once, and prunes old ones', async () => {
		const store = new DrizzleInboxStore({ table: tables.inbox });
		answer = () => [{ message_id: 'm' }];
		expect(await store.record('m', 'billing')).toBe(true);
		expect(queries()[0]).toContain('on conflict do nothing returning "message_id"');
		answer = () => [];
		expect(await store.record('m', 'billing')).toBe(false);

		answer = () => [{ message_id: 'a' }, { message_id: 'b' }];
		expect(await store.pruneBefore(new Date(0))).toBe(2);
		expect(queries()[2]).toStartWith(
			'delete from "billing"."inbox" where "billing"."inbox"."recorded_at" < $1'
		);
	});

	it('takes an advisory lock in the transaction', async () => {
		await new PgAdvisoryLock().lock('wallet:1');
		expect(fake.log[0]).toMatchObject({
			query: 'select pg_advisory_xact_lock(hashtextextended($1, 0))',
			params: ['wallet:1']
		});
	});
});
