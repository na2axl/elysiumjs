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

import { Service } from '@elysiumjs/olympus';
import { applyTableMarkers, getTableMarker } from '@elysiumjs/mnemosyne-drizzle';
import { ConcurrencyConflictError, IdempotencyConflictError } from '@elysiumjs/olympus/moirai';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
	getTableConfig,
	integer,
	jsonb,
	pgSchema,
	pgTable,
	primaryKey,
	text,
	timestamp,
	uuid
} from 'drizzle-orm/pg-core';

import {
	DrizzleEventStore,
	DrizzleIdempotencyStore,
	DrizzleInboxStore,
	DrizzleOutboxStore,
	DrizzleProjectionStorage,
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

	it('leaves the tables unpartitioned by default', () => {
		expect(getTableMarker(tables.events)).toBeUndefined();
		expect(getTableMarker(tables.outbox)).toBeUndefined();
		expect(getTableConfig(tables.events).columns.find((c) => c.name === 'position')?.primary).toBe(
			true
		);
	});

	it('partitions events and outbox by time, with the time column in their keys', () => {
		const partitioned = moiraiTables('billing', { partitioned: true });

		const events = getTableConfig(partitioned.events);
		expect(events.columns.some((c) => c.primary)).toBe(false);
		expect(events.primaryKeys[0]!.columns.map((c) => c.name)).toEqual(['position', 'occurred_at']);
		expect(events.uniqueConstraints[0]!.columns.map((c) => c.name)).toEqual([
			'aggregate_id',
			'version',
			'occurred_at'
		]);

		const outbox = getTableConfig(partitioned.outbox);
		expect(outbox.columns.some((c) => c.primary)).toBe(false);
		expect(outbox.primaryKeys[0]!.columns.map((c) => c.name)).toEqual(['id', 'created_at']);
		expect(outbox.indexes.map((i) => i.config.name)).toEqual(['outbox_due_idx']);

		const migration = [
			'CREATE TABLE "billing"."events" (\n\t"position" bigserial NOT NULL\n);',
			'CREATE TABLE "billing"."outbox" (\n\t"id" uuid NOT NULL\n);',
			'CREATE TABLE "billing"."inbox" (\n\t"consumer" text NOT NULL\n);'
		].join('\n--> statement-breakpoint\n');
		expect(applyTableMarkers(migration, Object.values(partitioned))).toBe(
			[
				'CREATE TABLE "billing"."events" (\n\t"position" bigserial NOT NULL\n) PARTITION BY RANGE ("occurred_at");',
				'CREATE TABLE "billing"."outbox" (\n\t"id" uuid NOT NULL\n) PARTITION BY RANGE ("created_at");',
				'CREATE TABLE "billing"."inbox" (\n\t"consumer" text NOT NULL\n);'
			].join('\n--> statement-breakpoint\n')
		);
	});

	it('reads and writes idempotency records, and reports a taken key as a conflict', async () => {
		const store = new DrizzleIdempotencyStore({ table: tables.idempotencyKeys });
		answer = (query) =>
			query.startsWith('select')
				? [{ key: 'k', action: 'pay', request_hash: 'h', response: null, created_at: new Date(0) }]
				: [];

		expect(await store.get('k')).toMatchObject({
			key: 'k',
			action: 'pay',
			requestHash: 'h',
			response: null
		});
		expect(queries()[0]).toContain(
			'from "billing"."idempotency_keys" where "billing"."idempotency_keys"."key" = $1'
		);

		await store.put({
			key: 'k2',
			action: 'pay',
			requestHash: 'h',
			response: { ok: true },
			createdAt: new Date(0)
		});
		expect(queries()[1]).toStartWith('insert into "billing"."idempotency_keys"');

		answer = () => {
			throw Object.assign(new Error('duplicate key'), { code: '23505' });
		};
		await expect(
			store.put({
				key: 'k',
				action: 'pay',
				requestHash: 'h',
				response: null,
				createdAt: new Date(0)
			})
		).rejects.toBeInstanceOf(IdempotencyConflictError);

		// Bun's SQL driver keeps the SQLSTATE in errno.
		answer = () => {
			throw Object.assign(new Error('duplicate key'), {
				code: 'ERR_POSTGRES_SERVER_ERROR',
				errno: '23505'
			});
		};
		await expect(
			store.put({
				key: 'k',
				action: 'pay',
				requestHash: 'h',
				response: null,
				createdAt: new Date(0)
			})
		).rejects.toBeInstanceOf(IdempotencyConflictError);
	});

	it('claims due outbox rows with skip locked, filtered, and marks them', async () => {
		const store = new DrizzleOutboxStore({ table: tables.outbox });
		const window = { now: new Date(0), leaseUntil: new Date(300_000), limit: 10 };
		expect(await store.claimDue({ ...window, kinds: [] })).toEqual([]);
		expect(fake.log).toEqual([]);

		await store.claimDue({ ...window, kinds: ['mail'], ids: ['a'] });
		const claim = queries()[0]!;
		// One statement moves the claimed rows past the lease, so that the relay can work on them
		// outside the claiming transaction.
		expect(claim).toStartWith(
			'update "billing"."outbox" set "available_at" = $1 where "billing"."outbox"."id" in (select'
		);
		expect(claim).toContain('returning');
		expect(claim).toContain('"dispatched_at" is null');
		expect(claim).toContain('"dead_at" is null');
		expect(claim).toContain('"kind" in ($3)');
		expect(claim).toContain('"id" in ($4)');
		expect(claim).toContain(
			'order by "billing"."outbox"."available_at" asc limit $5 for update skip locked)'
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

	it('works over a table of a domain schema whose key spans more columns', async () => {
		const iam = pgSchema('iam');
		const at = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
		const outbox = iam.table(
			'outbox',
			{
				id: uuid('id').notNull(),
				kind: text('kind').notNull(),
				payload: jsonb('payload').notNull(),
				createdAt: at('created_at').notNull().defaultNow(),
				availableAt: at('available_at').notNull().defaultNow(),
				attempts: integer('attempts').notNull().default(0),
				lastError: text('last_error'),
				dispatchedAt: at('dispatched_at'),
				deadAt: at('dead_at')
			},
			(t) => [primaryKey({ columns: [t.id, t.createdAt] })]
		);
		const store = new DrizzleOutboxStore({ table: outbox });

		await store.markDispatched('0190', new Date(0));
		expect(queries()).toEqual([
			expect.stringMatching(
				/^update "iam"."outbox" set "dispatched_at" = \$1 where "iam"."outbox"."id" = \$2/
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

	const event = {
		aggregateId: 'u-1',
		aggregateType: 'wallet',
		version: 3,
		type: 'KlapsSpent',
		schemaVersion: 2,
		data: { klaps: '5' },
		metadata: { actor: 'user:1' },
		occurredAt: new Date(0)
	};
	const row = {
		position: '7',
		transaction_id: '99',
		aggregate_id: 'u-1',
		aggregate_type: 'wallet',
		version: 3,
		type: 'KlapsSpent',
		schema_version: 2,
		data: { klaps: '5' },
		metadata: { actor: 'user:1' },
		occurred_at: new Date(0)
	};

	it('builds the events table with its unique stream version, and the projections table', () => {
		const events = getTableConfig(tables.events);
		expect(events.schema).toBe('billing');
		expect(events.uniqueConstraints.map((u) => u.name)).toEqual(['events_aggregate_version_uq']);
		expect(getTableConfig(tables.projections).name).toBe('projections');
	});

	it('loads a stream in version order, and reads the log by position', async () => {
		const store = new DrizzleEventStore({ table: tables.events });
		answer = () => [row];
		expect(await store.load('u-1', 2)).toEqual([{ ...event, position: 7n }]);
		expect(queries()[0]).toContain(
			'where (("billing"."events"."aggregate_id" = $1) and ("billing"."events"."version" > $2)) order by "billing"."events"."version" asc'
		);

		await store.readAll({ types: ['KlapsSpent'], afterPosition: 6n, limit: 10 });
		expect(queries()[1]).toContain(
			'where (("billing"."events"."position" > $1) and ("billing"."events"."type" in ($2))) order by "billing"."events"."position" asc limit $3'
		);
		await store.readAll({ limit: 5 });
		expect(queries()[2]).not.toContain('where');
		expect(await store.readAll({ types: [], limit: 5 })).toEqual([]);
	});

	it('locks each stream, checks its head, then appends', async () => {
		const store = new DrizzleEventStore({ table: tables.events });
		answer = (query) => (query.startsWith('select max') ? [{ version: 2 }] : []);
		await store.append([event, { ...event, version: 4 }]);
		expect(fake.log[0]).toMatchObject({
			query: 'select pg_advisory_xact_lock(hashtextextended($1::text, 0))',
			params: ['u-1']
		});
		expect(queries()[1]).toStartWith('select max("version") from "billing"."events"');
		expect(queries()[2]).toStartWith('insert into "billing"."events"');
		await store.append([]);
		expect(queries()).toHaveLength(3);
	});

	it('reports a stale head or a taken version as a concurrency conflict', async () => {
		const store = new DrizzleEventStore({ table: tables.events });
		answer = (query) => (query.startsWith('select max') ? [{ version: 3 }] : []);
		expect(store.append([event])).rejects.toBeInstanceOf(ConcurrencyConflictError);

		answer = (query) => {
			if (query.startsWith('select max')) return [{ version: 2 }];
			if (query.startsWith('insert')) throw Object.assign(new Error('dup'), { code: '23505' });
			return [];
		};
		expect(store.append([event])).rejects.toBeInstanceOf(ConcurrencyConflictError);
	});

	it('resets the tables of models, and keeps projection versions', async () => {
		const movements = pgTable('movements', { id: text('id') });
		const storage = new DrizzleProjectionStorage({ table: tables.projections });
		await storage.reset([{ table: movements }, movements]);
		expect(queries()).toEqual(['delete from "movements"', 'delete from "movements"']);
		expect(storage.reset([class NoTable {}])).rejects.toThrow('NoTable has no Drizzle table');

		answer = () => [{ version: 2 }];
		expect(await storage.version('wallet-movements')).toBe(2);
		answer = () => [];
		expect(await storage.version('other')).toBeUndefined();
		await storage.built('wallet-movements', 3);
		expect(queries().at(-1)).toContain(
			'on conflict ("name") do update set "version" = $4, "built_at" = $5'
		);
	});
});
