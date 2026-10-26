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

import type { Responder } from './fake-sql';

import { Service } from '@elysiumjs/core';
import { afterEach, describe, expect, it } from 'bun:test';
import * as d from 'drizzle-orm/pg-core';

import { DrizzleModel } from '../src/model';
import { DrizzleRepository } from '../src/repository';
import { pgTable } from '../src/table';
import { fakeConnection } from './fake-sql';

const books = pgTable('repo_books', {
	id: d.integer().primaryKey(),
	title: d.text().notNull()
});

class Book extends DrizzleModel(books) {}
class BookRepository extends DrizzleRepository(Book) {}

class ArchiveRepository extends DrizzleRepository(Book) {
	public static readonly connection = 'archive';
}

const dune = { id: 1, title: 'Dune' };
const emma = { id: 2, title: 'Emma' };

describe('DrizzleRepository', () => {
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

	it('paginate() counts the rows and selects the requested page', async () => {
		use((query) => (query.includes('count(*)') ? [{ count: 3 }] : [emma]));

		expect(await new BookRepository().paginate(1, 2)).toEqual({ page: 2, total: 3, data: [emma] });
		expect(statements()).toEqual([
			['select count(*) from "repo_books"', []],
			['select "id", "title" from "repo_books" limit $1 offset $2', [1, 1]]
		]);
	});

	it('paginate() starts at the first page', async () => {
		use((query) => (query.includes('count(*)') ? [{ count: 0 }] : []));

		expect(await new BookRepository().paginate(10)).toEqual({ page: 1, total: 0, data: [] });
		expect(statements()[1]).toEqual(['select "id", "title" from "repo_books" limit $1', [10]]);
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
			'select "id", "title" from "repo_books" where "repo_books"."title" = $1'
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

	it('uses the connection named by the repository', async () => {
		use(() => [dune], 'archive');

		expect(await new ArchiveRepository().all()).toEqual([dune]);
		expect(fake.log).toHaveLength(1);
	});
});
