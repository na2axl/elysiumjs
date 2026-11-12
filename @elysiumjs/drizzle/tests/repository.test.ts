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

import type { Responder } from './fake-sql';

import { Service } from '@elysiumjs/olympus';
import { Pruner, Repository, RepositoryKeyError } from '@elysiumjs/olympus/mnemosyne';
import { afterEach, describe, expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import * as d from 'drizzle-orm/pg-core';

import { DrizzleModel } from '../src/model';
import { pgTable } from '../src/table';
import { fakeConnection } from './fake-sql';

const books = pgTable('repo_books', {
	id: d.integer().primaryKey(),
	title: d.text().notNull()
});

class Book extends DrizzleModel(books) {}
class BookRepository extends Repository(Book) {}

class ArchiveRepository extends Repository(Book) {
	public static readonly connection = 'archive';
}

const dune = { id: 1, title: 'Dune' };
const emma = { id: 2, title: 'Emma' };

describe('Repository on Drizzle', () => {
	let fake: ReturnType<typeof fakeConnection>;

	const use = (respond: Responder, name = 'default') => {
		fake = fakeConnection(respond);
		Service.instance(`db.connection.${name}`, fake.connection);
	};

	const statements = () => fake.log.map(({ query, params }) => [query, params]);

	afterEach(() => {
		Service.remove('db.connection.default');
		Service.remove('db.connection.archive');
	});

	it('all() selects every row', async () => {
		use(() => [dune, emma]);

		expect(await new BookRepository().all()).toEqual([dune, emma]);
		expect(statements()).toEqual([['select "id", "title" from "repo_books"', []]]);
	});

	it('find() returns the row with the id, or null', async () => {
		use((_, params) => (params[0] === 1 ? [dune] : []));
		const repository = new BookRepository();

		expect(await repository.find(1)).toEqual(dune);
		expect(await repository.find(9)).toBeNull();
		expect(fake.log[0]!.query).toBe(
			'select "id", "title" from "repo_books" where "repo_books"."id" = $1'
		);
	});

	it('findBy() returns the first row matching the column, or null', async () => {
		use((_, params) => (params[0] === 'Emma' ? [emma] : []));
		const repository = new BookRepository();

		expect(await repository.findBy('title', 'Emma')).toEqual(emma);
		expect(await repository.findBy('title', 'Nope')).toBeNull();
		expect(fake.log[0]!.query).toBe(
			'select "id", "title" from "repo_books" where "repo_books"."title" = $1 limit $2'
		);
	});

	it('insert() returns the inserted row', async () => {
		use(() => [dune]);

		expect(await new BookRepository().insert(dune)).toEqual(dune);
		expect(statements()).toEqual([
			[
				'insert into "repo_books" ("id", "title") values ($1, $2) returning "id", "title"',
				[1, 'Dune']
			]
		]);
	});

	it('update() returns the updated row', async () => {
		use(() => [{ ...dune, title: 'Dune Messiah' }]);

		expect(await new BookRepository().update(1, { title: 'Dune Messiah' })).toEqual({
			id: 1,
			title: 'Dune Messiah'
		});
		expect(statements()).toEqual([
			[
				'update "repo_books" set "title" = $1 where "repo_books"."id" = $2 returning "id", "title"',
				['Dune Messiah', 1]
			]
		]);
	});

	it('update() returns null when no row has the id', async () => {
		use(() => []);

		expect(await new BookRepository().update(9, { title: 'Nope' })).toBeNull();
	});

	it('updateAll() returns every updated row', async () => {
		use(() => [
			{ ...dune, title: 'Same' },
			{ ...emma, title: 'Same' }
		]);

		expect(await new BookRepository().updateAll({ title: 'Same' })).toHaveLength(2);
		expect(fake.log[0]!.query).toBe('update "repo_books" set "title" = $1 returning "id", "title"');
	});

	it('delete() returns the deleted row', async () => {
		use(() => [dune]);

		expect(await new BookRepository().delete(1)).toEqual(dune);
		expect(statements()).toEqual([
			['delete from "repo_books" where "repo_books"."id" = $1 returning "id", "title"', [1]]
		]);
	});

	it('delete() returns null when no row has the id', async () => {
		use(() => []);

		expect(await new BookRepository().delete(9)).toBeNull();
	});

	it('deleteAll() returns every deleted row', async () => {
		use(() => [dune, emma]);

		expect(await new BookRepository().deleteAll()).toEqual([dune, emma]);
		expect(fake.log[0]!.query).toBe('delete from "repo_books" returning "id", "title"');
	});

	it('exists() checks whether a row has the id', async () => {
		use((_, params) => [{ count: params[0] === 1 ? 1 : 0 }]);
		const repository = new BookRepository();

		expect(await repository.exists(1)).toBe(true);
		expect(await repository.exists(9)).toBe(false);
		expect(fake.log[0]!.query).toBe(
			'select count(*) from "repo_books" where "repo_books"."id" = $1'
		);
	});

	it('deleteWhere() deletes the rows of a scope, at most a limit of them', async () => {
		use(() => [{ deleted: 1 }, { deleted: 1 }]);
		const repository = new BookRepository();

		expect(await repository.deleteWhere(eq(books.title, 'Dune'), 2)).toBe(2);
		expect(statements()).toEqual([
			[
				'delete from "repo_books" where (("repo_books"."title" = $1) and ((tableoid, ctid) in (select tableoid, ctid from "repo_books" where "repo_books"."title" = $2 limit $3))) returning 1',
				['Dune', 'Dune', 2]
			]
		]);
	});

	it('deleteWhere() without a limit deletes every row of the scope', async () => {
		use(() => [{ deleted: 1 }]);

		expect(await new BookRepository().deleteWhere(eq(books.title, 'Dune'))).toBe(1);
		expect(statements()).toEqual([
			['delete from "repo_books" where "repo_books"."title" = $1 returning 1', ['Dune']]
		]);
	});

	it('runs a Pruner over the scope, chunk by chunk', async () => {
		let left = 3;
		use(() => {
			const deleted = Math.min(left, 2);
			left -= deleted;
			return Array.from({ length: deleted }, () => ({ deleted: 1 }));
		});

		class PruneDune extends Pruner(Book) {
			protected get prunable() {
				return eq(books.title, 'Dune');
			}

			protected override get chunkSize() {
				return 2;
			}
		}

		const job = new PruneDune();
		await job.run();
		expect(job.pruned).toBe(3);
		expect(fake.log).toHaveLength(2);
	});

	it('runs the pruning() hook of a Pruner on each chunk, then deletes it by key', async () => {
		use((query) => (query.startsWith('select') ? [dune, emma] : [{ deleted: 1 }, { deleted: 1 }]));
		const seen: unknown[] = [];

		class PruneAll extends Pruner(Book) {
			protected get prunable() {
				return eq(books.id, books.id);
			}

			protected override pruning(rows: (typeof Book)['$inferSelect'][]) {
				seen.push(...rows);
			}
		}

		const job = new PruneAll();
		await job.run();
		expect(seen).toEqual([dune, emma]);
		expect(job.pruned).toBe(2);
		expect(statements()[1]).toEqual([
			'delete from "repo_books" where "repo_books"."id" in ($1, $2) returning 1',
			[1, 2]
		]);
	});

	it('uses the connection named by the repository', async () => {
		use(() => [dune], 'archive');

		expect(await new ArchiveRepository().all()).toEqual([dune]);
		expect(fake.log).toHaveLength(1);
	});
});

const follows = pgTable(
	'repo_follows',
	{ userId: d.uuid('user_id').notNull(), creatorId: d.uuid('creator_id').notNull(), at: d.text() },
	(t) => [d.primaryKey({ columns: [t.userId, t.creatorId] })]
);
class Follow extends DrizzleModel(follows) {}
class FollowRepository extends Repository(Follow) {}

const handles = pgTable('repo_handles', { handle: d.text().primaryKey(), owner: d.text() });
class Handle extends DrizzleModel(handles) {}
class HandleRepository extends Repository(Handle) {}

const slugs = pgTable('repo_slugs', { slug: d.text().notNull(), title: d.text() });
class Slug extends DrizzleModel(slugs) {}
class SlugRepository extends Repository(Slug, { key: ['slug'] }) {}
class KeylessRepository extends Repository(Slug) {}

describe('Repository on Drizzle keys', () => {
	let fake: ReturnType<typeof fakeConnection>;

	const use = (respond: Responder) => {
		fake = fakeConnection(respond);
		Service.instance('db.connection.default', fake.connection);
	};

	afterEach(() => Service.remove('db.connection.default'));

	it('uses a primary key column that is not id', async () => {
		use(() => [{ handle: 'ada', owner: 'u1' }]);
		expect(await new HandleRepository().find('ada')).toEqual({ handle: 'ada', owner: 'u1' });
		expect(fake.log[0]!.query).toBe(
			'select "handle", "owner" from "repo_handles" where "repo_handles"."handle" = $1'
		);
	});

	it('takes an object of the columns of a composite key', async () => {
		use(() => [{ count: 1 }]);
		const repository = new FollowRepository();
		const key = { userId: 'u1', creatorId: 'c1' };

		expect(await repository.exists(key)).toBe(true);
		await repository.update(key, { at: 'now' });
		await repository.delete(key);
		expect(fake.log.map(({ query }) => query)).toEqual([
			'select count(*) from "repo_follows" where (("repo_follows"."user_id" = $1) and ("repo_follows"."creator_id" = $2))',
			'update "repo_follows" set "at" = $1 where (("repo_follows"."user_id" = $2) and ("repo_follows"."creator_id" = $3)) returning "user_id", "creator_id", "at"',
			'delete from "repo_follows" where (("repo_follows"."user_id" = $1) and ("repo_follows"."creator_id" = $2)) returning "user_id", "creator_id", "at"'
		]);
	});

	it('refuses a single value or a partial key for a composite key', async () => {
		use(() => []);
		const repository = new FollowRepository();
		await expect(repository.find('u1')).rejects.toBeInstanceOf(RepositoryKeyError);
		await expect(repository.find({ userId: 'u1' })).rejects.toThrow('misses creatorId');
	});

	it('takes the key columns it is given', async () => {
		use(() => []);
		await new SlugRepository().find('dune');
		expect(fake.log[0]!.query).toBe(
			'select "slug", "title" from "repo_slugs" where "repo_slugs"."slug" = $1'
		);
	});

	it('says when the table has no primary key', async () => {
		use(() => []);
		await expect(new KeylessRepository().find('dune')).rejects.toThrow('has no primary key');
	});
});
