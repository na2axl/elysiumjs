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

// Runs against a real PostgreSQL when DATABASE_URL is set, such as
// DATABASE_URL=postgres://postgres:postgres@localhost:5432/elysium_test bun test.

import { Service } from '@elysiumjs/olympus';
import { NotificationStore } from '@elysiumjs/olympus/hermes';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { sql } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';

import { DrizzleNotificationStore, notificationsTable } from '../src';
import { bunSql } from '../src/drivers/bun-sql';

const url = process.env.DATABASE_URL;
const table = notificationsTable('pg_hermes_notifications');

describe('notificationsTable', () => {
	it('builds the table, its indexes and a schema', () => {
		const config = getTableConfig(table);
		expect(config.columns.map((c) => c.name)).toEqual([
			'id',
			'delivery_id',
			'notifiable_type',
			'notifiable_id',
			'type',
			'data',
			'read_at',
			'created_at'
		]);
		expect(config.indexes.map((i) => i.config.name)).toEqual([
			'pg_hermes_notifications_delivery_uq',
			'pg_hermes_notifications_notifiable_idx',
			'pg_hermes_notifications_unread_idx'
		]);
		expect(getTableConfig(notificationsTable(undefined, 'social')).schema).toBe('social');
	});

	it('registers the drizzle driver of the notification store', () => {
		expect(NotificationStore.has('drizzle')).toBe(true);
	});
});

describe.skipIf(!url)('DrizzleNotificationStore on PostgreSQL', () => {
	const driver = bunSql({ url });
	const db = driver.connect({});
	const store = NotificationStore.for('drizzle', { table });
	const row = (id: string, notifiableId = 'u1') => ({
		id,
		deliveryId: `d-${id}`,
		notifiableType: null,
		notifiableId,
		type: 'invoice.paid',
		data: { id },
		readAt: null,
		createdAt: new Date('2026-01-01T00:00:00Z')
	});

	beforeAll(async () => {
		Service.instance('db.connection.default', db);
		await db.execute(sql`drop table if exists pg_hermes_notifications`);
		await db.execute(
			sql`create table pg_hermes_notifications (id text primary key, delivery_id text not null unique, notifiable_type text, notifiable_id text not null, type text not null, data jsonb not null, read_at timestamptz, created_at timestamptz not null)`
		);
	});

	beforeEach(async () => {
		await db.execute(sql`truncate pg_hermes_notifications`);
	});

	afterAll(async () => {
		await db.execute(sql`drop table if exists pg_hermes_notifications`);
		Service.remove('db.connection.default');
		await driver.close(db);
	});

	it('pages newest first, counts, marks as read and deletes', async () => {
		expect(store).toBeInstanceOf(DrizzleNotificationStore);
		for (const id of ['a', 'b', 'c']) await store.save(row(id));
		await store.save(row('z', 'u2'));
		await store.save({ ...row('a'), type: 'again' });
		await store.save({ ...row('x'), deliveryId: 'd-a' });
		await store.save({ ...row('t'), notifiableType: 'team' });
		const u1 = { notifiableId: 'u1' };
		const u2 = { notifiableId: 'u2' };

		const first = await store.list(u1, { limit: 2 });
		expect(first.items.map((r) => r.id)).toEqual(['c', 'b']);
		expect(first.items[0]).toEqual(row('c'));
		const second = await store.list(u1, { limit: 2, cursor: first.nextCursor! });
		expect(second).toMatchObject({ items: [{ id: 'a', type: 'invoice.paid' }], nextCursor: null });

		expect(await store.markAsRead(u1, ['b', 'z'])).toBe(1);
		expect(await store.markAsRead(u1, [])).toBe(0);
		expect(await store.unreadCount(u1)).toBe(2);
		expect((await store.list(u1, { unread: true })).items.map((r) => r.id)).toEqual(['c', 'a']);
		expect((await store.list(u1)).items.find((r) => r.id === 'b')?.readAt).toBeInstanceOf(Date);
		expect(await store.markAllAsRead(u1)).toBe(2);
		expect(await store.unreadCount(u1)).toBe(0);
		expect(await store.delete(u1, ['a', 'z'])).toBe(1);
		expect(await store.unreadCount(u2)).toBe(1);
		expect(await store.unreadCount({ notifiableId: 'u1', notifiableType: 'team' })).toBe(1);
	});
});
