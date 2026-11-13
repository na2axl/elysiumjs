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
import {
	Listing,
	makeCacheInterface,
	MEMORY_CACHE_SERVICE,
	Pruner,
	Repository
} from '@elysiumjs/olympus/mnemosyne';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { eq, gt, sql } from 'drizzle-orm';
import * as d from 'drizzle-orm/pg-core';

import { Database } from '../src/database';
import { bunSql } from '../src/drivers/bun-sql';
import { DrizzleModel } from '../src/model';
import { pgTable } from '../src/table';

const url = process.env.DATABASE_URL;

const articles = pgTable('pg_repo_articles', {
	id: d.integer().primaryKey(),
	title: d.text().notNull(),
	views: d.integer().notNull()
});

const tags = pgTable(
	'pg_repo_tags',
	{ articleId: d.integer().notNull(), tag: d.text().notNull() },
	(t) => [d.primaryKey({ columns: [t.articleId, t.tag] })]
);

const events = pgTable(
	'pg_repo_events',
	{ id: d.integer().notNull(), day: d.integer().notNull() },
	(t) => [d.primaryKey({ columns: [t.id, t.day] })]
);

class Article extends DrizzleModel(articles) {}
class ArticleRepository extends Repository(Article) {}
class CachedArticleRepository extends Repository(Article) {
	public static override readonly cache = { ttl: 60_000 };
}
class Tag extends DrizzleModel(tags) {}
class TagRepository extends Repository(Tag) {}
class Event extends DrizzleModel(events) {}
class EventRepository extends Repository(Event) {}

describe.skipIf(!url)('Repository on PostgreSQL', () => {
	const driver = bunSql({ url });
	const db = driver.connect({});

	beforeAll(async () => {
		Service.instance('db.connection.default', db);
		await db.execute(sql`drop table if exists pg_repo_articles, pg_repo_tags, pg_repo_events`);
		await db.execute(
			sql`create table pg_repo_events (id integer not null, day integer not null, primary key (id, day)) partition by range (day)`
		);
		await db.execute(
			sql`create table pg_repo_events_1 partition of pg_repo_events for values from (1) to (2)`
		);
		await db.execute(
			sql`create table pg_repo_events_2 partition of pg_repo_events for values from (2) to (3)`
		);
		await db.execute(
			sql`create table pg_repo_articles (id integer primary key, title text not null, views integer not null)`
		);
		await db.execute(
			sql`create table pg_repo_tags ("articleId" integer not null, tag text not null, primary key ("articleId", tag))`
		);
	});

	beforeEach(async () => {
		await db.execute(sql`truncate pg_repo_articles, pg_repo_tags, pg_repo_events`);
		const repository = new ArticleRepository();
		for (let id = 1; id <= 5; id++) {
			await repository.insert({ id, title: `Article ${id}`, views: id * 10 });
		}
	});

	afterAll(async () => {
		await db.execute(sql`drop table if exists pg_repo_articles, pg_repo_tags, pg_repo_events`);
		Service.remove('db.connection.default');
		await driver.close(db);
	});

	it('runs CRUD and listing', async () => {
		const repository = new ArticleRepository();
		expect(await repository.find(1)).toEqual({ id: 1, title: 'Article 1', views: 10 });
		expect(await repository.find(1)).toBeInstanceOf(Article);
		expect(await repository.update(1, { views: 99 })).toMatchObject({ views: 99 });
		expect(await repository.exists(2)).toBe(true);
		expect(await repository.delete(2)).toMatchObject({ id: 2 });
		const spec = {
			pagination: 'cursor',
			sort: ['views'],
			defaultSort: '-views',
			limit: { default: 2 }
		} as const;
		const page = await repository.list(Listing.parse(spec, {}));
		expect(page.data.map((row) => row.id)).toEqual([1, 5]);
		expect(page.data[0]).toBeInstanceOf(Article);
		expect(Article.modelName).toBe('public.pg_repo_articles');
		expect(await repository.count(undefined, gt(articles.views, 30))).toBe(3);
	});

	it('reads through its cache, and past it in a transaction', async () => {
		Service.instance(
			MEMORY_CACHE_SERVICE,
			makeCacheInterface(() => new Map() as never)
		);
		try {
			const cached = new CachedArticleRepository();
			expect((await cached.find(1))!.views).toBe(10);
			await db.execute(sql`update pg_repo_articles set views = 77 where id = 1`);
			expect((await cached.find(1))!.views).toBe(10);
			await Database.transaction(async () => {
				expect((await cached.find(1))!.views).toBe(77);
			});
			await cached.update(1, { title: 'changed' });
			expect((await cached.find(1))!.views).toBe(77);

			// A write in a transaction is forgotten again once it commits.
			let queued = false;
			await Database.transaction(async () => {
				await cached.update(1, { views: 88 });
				queued = Database.afterCommit('default', () => undefined);
			});
			expect(queued).toBe(true);
			expect((await cached.find(1))!.views).toBe(88);
			expect(Database.afterCommit('default', () => undefined)).toBe(false);
		} finally {
			Service.remove(MEMORY_CACHE_SERVICE);
		}
	});

	it('sorts numbers as numbers', async () => {
		const repository = new ArticleRepository();
		await repository.insert({ id: 6, title: 'Article 6', views: 100 });
		await repository.insert({ id: 7, title: 'Article 7', views: 9 });
		const spec = { pagination: 'cursor', sort: ['views'], limit: { default: 3 } } as const;
		const page = await repository.list(Listing.parse(spec, { sort: '-views' }));
		expect(page.data.map((row) => row.views)).toEqual([100, 50, 40]);
	});

	it('deletes at most a limit of the rows of a scope', async () => {
		const repository = new ArticleRepository();
		expect(await repository.deleteWhere(gt(articles.views, 10), 2)).toBe(2);
		expect(await repository.count()).toBe(3);
		expect(await repository.deleteWhere(gt(articles.views, 10))).toBe(2);
		expect((await repository.all()).map((row) => row.id)).toEqual([1]);
	});

	it('prunes in chunks, with and without a hook', async () => {
		class PruneViews extends Pruner(Article) {
			protected get prunable() {
				return gt(articles.views, 20);
			}

			protected override get chunkSize() {
				return 2;
			}
		}
		const plain = new PruneViews();
		await plain.run();
		expect(plain.pruned).toBe(3);

		const seen: number[] = [];
		class PruneRest extends Pruner(Article) {
			protected get prunable() {
				return gt(articles.views, 0);
			}

			protected override pruning(rows: (typeof Article)['$inferSelect'][]) {
				seen.push(...rows.map((row) => row.id));
			}
		}
		const hooked = new PruneRest();
		await hooked.run();
		expect(seen.sort()).toEqual([1, 2]);
		expect(await new ArticleRepository().count()).toBe(0);
	});

	it('runs the pruning() hook over several chunks', async () => {
		const seen: number[][] = [];
		class PruneInChunks extends Pruner(Article) {
			protected get prunable() {
				return gt(articles.views, 0);
			}

			protected override get chunkSize() {
				return 2;
			}

			protected override pruning(rows: (typeof Article)['$inferSelect'][]) {
				seen.push(rows.map((row) => row.id).sort());
			}
		}
		const job = new PruneInChunks();
		await job.run();
		expect(job.pruned).toBe(5);
		expect(seen.map((chunk) => chunk.length)).toEqual([2, 2, 1]);
		expect(seen.flat().sort()).toEqual([1, 2, 3, 4, 5]);
	});

	it('deletes a limit of the rows of a partitioned table', async () => {
		const repository = new EventRepository();
		for (const day of [1, 2]) {
			for (let id = 1; id <= 3; id++) await repository.insert({ id, day });
		}
		expect(await repository.deleteWhere(eq(events.id, 1), 1)).toBe(1);
		expect(await repository.count()).toBe(5);
		expect(await repository.deleteWhere(gt(events.id, 0), 3)).toBe(3);
		expect(await repository.count()).toBe(2);
	});

	it('finds and deletes rows by a composite key', async () => {
		const repository = new TagRepository();
		await repository.insert({ articleId: 1, tag: 'news' });
		await repository.insert({ articleId: 1, tag: 'tech' });
		expect(await repository.find({ articleId: 1, tag: 'tech' })).toEqual({
			articleId: 1,
			tag: 'tech'
		});
		expect(await repository.deleteWhere(eq(tags.articleId, 1), 1)).toBe(1);
		expect(await repository.count()).toBe(1);
	});

	it('prunes rows by a composite key after the hook', async () => {
		const repository = new TagRepository();
		for (const tag of ['a', 'b', 'c']) await repository.insert({ articleId: 2, tag });
		const seen: string[] = [];
		class PruneTags extends Pruner(Tag) {
			protected get prunable() {
				return eq(tags.articleId, 2);
			}

			protected override pruning(rows: (typeof Tag)['$inferSelect'][]) {
				seen.push(...rows.map((row) => row.tag));
			}
		}
		const job = new PruneTags();
		await job.run();
		expect(job.pruned).toBe(3);
		expect(seen.sort()).toEqual(['a', 'b', 'c']);
		expect(await repository.count()).toBe(0);
	});
});
