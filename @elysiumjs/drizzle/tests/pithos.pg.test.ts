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

import type { FileRecord } from '@elysiumjs/olympus/pithos';

import { Service } from '@elysiumjs/olympus';
import { FileStore } from '@elysiumjs/olympus/pithos';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { sql } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';

import { filesTable } from '../src';
import { bunSql } from '../src/drivers/bun-sql';

const url = process.env.DATABASE_URL;
const table = filesTable('pg_pithos_files');

describe('filesTable', () => {
	it('builds the table, its indexes and a schema', () => {
		const config = getTableConfig(table);
		expect(config.columns.map((c) => c.name)).toEqual([
			'id',
			'purpose',
			'disk',
			'key',
			'content_type',
			'size',
			'owner_type',
			'owner_id',
			'created_by',
			'status',
			'created_at',
			'ready_at',
			'claimed_at',
			'released_at',
			'expires_at',
			'deleted_at',
			'rejection'
		]);
		expect(config.indexes.map((i) => i.config.name)).toEqual([
			'pg_pithos_files_owner_idx',
			'pg_pithos_files_pending_idx',
			'pg_pithos_files_due_idx'
		]);
		expect(getTableConfig(filesTable(undefined, 'media')).schema).toBe('media');
	});

	it('registers the drizzle driver of the file store', () => {
		expect(FileStore.has('drizzle')).toBe(true);
	});
});

describe.skipIf(!url)('DrizzleFileStore on PostgreSQL', () => {
	const driver = bunSql({ url });
	const db = driver.connect({});
	const store = FileStore.for('drizzle', { table });
	const at = (minutes: number) => new Date(Date.UTC(2026, 0, 1, 0, minutes));
	const record = (id: string, patch: Partial<FileRecord> = {}): FileRecord => ({
		id,
		purpose: 'avatar',
		disk: 'public',
		key: `avatar/${id}`,
		contentType: 'image/png',
		size: 42,
		owner: { type: 'user', id: 'alice' },
		createdBy: 'alice',
		status: 'pending',
		createdAt: at(0),
		readyAt: null,
		claimedAt: null,
		releasedAt: null,
		expiresAt: at(15),
		deletedAt: null,
		rejection: null,
		...patch
	});

	beforeAll(async () => {
		Service.instance('db.connection.default', db);
		await db.execute(sql`drop table if exists pg_pithos_files`);
		await db.execute(
			sql`create table pg_pithos_files (id text primary key, purpose text not null, disk text not null, key text not null, content_type text not null, size bigint not null, owner_type text not null, owner_id text not null, created_by text, status text not null, created_at timestamptz not null, ready_at timestamptz, claimed_at timestamptz, released_at timestamptz, expires_at timestamptz, deleted_at timestamptz, rejection text)`
		);
	});

	beforeEach(async () => {
		await db.execute(sql`truncate pg_pithos_files`);
	});

	afterAll(async () => {
		await db.execute(sql`drop table if exists pg_pithos_files`);
		Service.remove('db.connection.default');
	});

	it('inserts and finds records, with their owner', async () => {
		await store.insert(record('f1'));
		expect(await store.find('f1')).toEqual(record('f1'));
		expect(await store.find('none')).toBeNull();
	});

	it('changes a record only while it meets the condition', async () => {
		await store.insert(record('f1'));
		const ready = await store.transition(
			'f1',
			{ status: ['pending'], live: at(10) },
			{ status: 'ready', readyAt: at(10), expiresAt: at(60) }
		);
		expect(ready).toMatchObject({ status: 'ready', readyAt: at(10), expiresAt: at(60) });
		expect(
			await store.transition('f1', { status: ['pending'] }, { status: 'rejected' })
		).toBeNull();
		expect(
			await store.transition('f1', { status: ['ready'], live: at(60) }, { claimedAt: at(60) })
		).toBeNull();
		expect(await store.transition('f1', { status: ['ready'], due: at(59) }, {})).toBeNull();
		expect(
			await store.transition('f1', { status: ['ready'], due: at(60) }, { status: 'deleted' })
		).toMatchObject({ status: 'deleted' });
	});

	it('counts pending uploads and lists the due records', async () => {
		await store.insert(record('a'));
		await store.insert(record('b', { expiresAt: at(5) }));
		await store.insert(record('c', { createdBy: 'bob' }));
		await store.insert(record('d', { status: 'ready', expiresAt: at(3) }));
		await store.insert(record('e', { status: 'ready', expiresAt: null }));
		await store.insert(record('f', { status: 'rejected', expiresAt: null }));
		await store.insert(record('g', { status: 'finishing', createdBy: 'carol', expiresAt: at(4) }));
		expect(await store.countPending('alice', at(4))).toBe(2);
		expect(await store.countPending('alice', at(10))).toBe(1);
		expect((await store.due(at(10), 10)).map((file) => file.id)).toEqual(['d', 'g', 'b']);
		expect((await store.due(at(10), 1)).map((file) => file.id)).toEqual(['d']);
	});
});
