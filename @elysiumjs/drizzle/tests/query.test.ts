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
import { Listing, Repository } from '@elysiumjs/olympus/mnemosyne';
import { afterEach, describe, expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import * as d from 'drizzle-orm/pg-core';

import { DrizzleModel } from '../src/model';
import { pgTable } from '../src/table';
import { fakeConnection } from './fake-sql';

const posts = pgTable('query_posts', {
	id: d.integer().primaryKey(),
	title: d.text().notNull(),
	status: d.text().notNull(),
	createdAt: d.timestamp('created_at', { withTimezone: true }).notNull()
});

class Post extends DrizzleModel(posts) {}
class PostRepository extends Repository(Post) {}

const spec = Listing.define(Post, {
	filters: { status: ['eq', 'in'], title: ['contains'], createdAt: ['gte'] },
	sort: ['createdAt', 'title'],
	defaultSort: '-createdAt',
	limit: { default: 2 }
});

const rows = [
	{ id: 3, title: 'c', status: 'draft', createdAt: '2026-03-01 00:00:00+00' },
	{ id: 2, title: 'b', status: 'draft', createdAt: '2026-02-01 00:00:00+00' },
	{ id: 1, title: 'a', status: 'draft', createdAt: '2026-01-01 00:00:00+00' }
];

describe('Repository on Drizzle.list()', () => {
	let fake: ReturnType<typeof fakeConnection>;

	afterEach(() => Service.remove('db.connection.default'));

	const use = (respond: (query: string) => Record<string, unknown>[]) => {
		fake = fakeConnection(respond);
		Service.instance('db.connection.default', fake.connection);
	};

	it('filters, sorts with the key as tiebreaker, and fetches one row more than the limit', async () => {
		use(() => rows);
		const query = Listing.parse(spec, {
			'filter[status][in]': 'draft,published',
			'filter[title][contains]': '50%_off'
		});

		const page = await new PostRepository().list(query);

		expect(fake.log[0]).toEqual({
			client: 'root',
			query:
				'select "id", "title", "status", "created_at" from "query_posts" where (("query_posts"."status" in ($1, $2)) and ("query_posts"."title" ilike $3)) order by "query_posts"."created_at" desc, "query_posts"."id" desc limit $4',
			params: ['draft', 'published', '%50\\%\\_off%', 3]
		});
		expect(page.data.map((row) => row.id)).toEqual([3, 2]);
		expect(page.nextCursor).not.toBeNull();
	});

	it('continues after the cursor with a keyset condition', async () => {
		use(() => rows.slice(2));
		const first = Listing.parse(spec);
		const cursor = Listing.cursorAfter(first, {
			id: 2,
			createdAt: new Date('2026-02-01T00:00:00Z')
		});

		const page = await new PostRepository().list(Listing.parse(spec, { cursor }));

		expect(fake.log[0]!.query).toBe(
			'select "id", "title", "status", "created_at" from "query_posts" where (("query_posts"."created_at" < $1) or ((("query_posts"."created_at" = $2) and ("query_posts"."id" < $3)))) order by "query_posts"."created_at" desc, "query_posts"."id" desc limit $4'
		);
		expect(fake.log[0]!.params).toEqual([
			'2026-02-01T00:00:00.000Z',
			'2026-02-01T00:00:00.000Z',
			2,
			3
		]);
		expect(page.nextCursor).toBeNull();
	});

	it('lists a page of an offset listing, with the total of its filters', async () => {
		use((query) => (query.startsWith('select count') ? [{ count: 5 }] : rows.slice(0, 2)));
		const query = Listing.parse(
			{ ...spec, pagination: 'offset' as const },
			{
				'filter[status]': 'draft',
				page: '2'
			}
		);

		const page = await new PostRepository().list(query);

		expect(fake.log[0]!.query).toBe(
			'select "id", "title", "status", "created_at" from "query_posts" where "query_posts"."status" = $1 order by "query_posts"."created_at" desc, "query_posts"."id" desc limit $2 offset $3'
		);
		expect(fake.log[0]!.params).toEqual(['draft', 2, 2]);
		expect(page).toEqual({ data: rows.slice(0, 2) as any, page: 2, limit: 2, total: 5 });
		expect(Listing.isPage(page)).toBe(true);
	});

	it('counts the rows matching the filters', async () => {
		use(() => [{ count: 7 }]);

		expect(
			await new PostRepository().count(Listing.parse(spec, { 'filter[status]': 'draft' }))
		).toBe(7);
		expect(fake.log[0]!.query).toBe(
			'select count(*) from "query_posts" where "query_posts"."status" = $1'
		);
	});

	it('ANDs a scope with the filters of the query, in the page and in the count', async () => {
		use((query) => (query.includes('count(*)') ? [{ count: 1 }] : rows.slice(0, 1)));
		const query = Listing.parse(spec, { 'filter[status]': 'draft' });
		const repository = new PostRepository();

		await repository.list(query, eq(posts.title, 'c'));
		expect(fake.log[0]!.query).toBe(
			'select "id", "title", "status", "created_at" from "query_posts" where (("query_posts"."status" = $1) and ("query_posts"."title" = $2)) order by "query_posts"."created_at" desc, "query_posts"."id" desc limit $3'
		);
		expect(fake.log[0]!.params).toEqual(['draft', 'c', 3]);

		expect(await repository.count(query, eq(posts.title, 'c'))).toBe(1);
		expect(fake.log[1]!.query).toBe(
			'select count(*) from "query_posts" where (("query_posts"."status" = $1) and ("query_posts"."title" = $2))'
		);
	});

	it('lists with a scope alone', async () => {
		use(() => []);
		await new PostRepository().list(Listing.parse(spec), eq(posts.status, 'published'));
		expect(fake.log[0]!.query).toContain('where "query_posts"."status" = $1 order by');
	});
});
