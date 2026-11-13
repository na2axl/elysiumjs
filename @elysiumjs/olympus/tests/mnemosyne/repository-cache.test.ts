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

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { DATABASE_TRANSACTION_SERVICE, Service } from '../../src/index';
import {
	MEMORY_CACHE_SERVICE,
	MemoryDatabase,
	MemoryModel,
	Repository,
	REPOSITORY_CACHE_SERVICE,
	UnitOfWork,
	withTenant,
	withUnitOfWork
} from '../../src/mnemosyne';
import { makeCacheInterface } from '../../src/mnemosyne/cache';

type Book = { id: string; title: string; isbn: string; at: Date };

class BookModel extends MemoryModel<Book>('cached-books') {}

/** Reads through the default cache of the module. */
class BookRepository extends Repository(BookModel) {}

/** Writes behind the cache's back, as another process would. */
class DirectRepository extends Repository(BookModel) {
	public static override readonly cache = false;
}

class ShortRepository extends Repository(BookModel) {
	public static override readonly cache = { ttl: 20 };
}

const book = (id: string): Book => ({
	id,
	title: `Book ${id}`,
	isbn: `isbn-${id}`,
	at: new Date('2026-01-01T00:00:00.000Z')
});

const store = () => makeCacheInterface(() => new Map() as never);

beforeEach(() => {
	Service.instance(MEMORY_CACHE_SERVICE, store());
	Service.instance(REPOSITORY_CACHE_SERVICE, { store: 'memory', ttl: 60_000 });
});

afterEach(() => {
	MemoryDatabase.reset();
	Service.remove(MEMORY_CACHE_SERVICE);
	Service.remove(REPOSITORY_CACHE_SERVICE);
	Service.remove(DATABASE_TRANSACTION_SERVICE);
});

describe('Repository cache', () => {
	it('reads rows by key through the cache, as instances with their dates', async () => {
		const books = new BookRepository();
		const direct = new DirectRepository();
		await direct.insert(book('b1'));

		const first = await books.find('b1');
		await direct.update('b1', { title: 'behind the cache' });
		const second = await books.find('b1');

		expect(second).toBeInstanceOf(BookModel);
		expect(second!.title).toBe(first!.title);
		expect(second!.at).toBeInstanceOf(Date);
		expect((await direct.find('b1'))!.title).toBe('behind the cache');
	});

	it('forgets a row it updates or deletes', async () => {
		const books = new BookRepository();
		await books.insert(book('b2'));
		await books.find('b2');

		await books.update('b2', { title: 'new' });
		expect((await books.find('b2'))!.title).toBe('new');

		await books.delete('b2');
		expect(await books.find('b2')).toBeNull();
	});

	it('does not cache missing rows', async () => {
		const books = new BookRepository();
		expect(await books.find('b3')).toBeNull();
		await new DirectRepository().insert(book('b3'));
		expect(await books.find('b3')).not.toBeNull();
	});

	it('reads findBy() through the key of the row, and checks the value', async () => {
		const books = new BookRepository();
		const direct = new DirectRepository();
		await direct.insert(book('b4'));

		expect((await books.findBy('isbn', 'isbn-b4'))!.id).toBe('b4');
		await direct.update('b4', { title: 'behind' });
		expect((await books.findBy('isbn', 'isbn-b4'))!.title).toBe('Book b4');

		// The row changed its value through the repository: the lookup is a miss.
		await books.update('b4', { isbn: 'other' });
		expect(await books.findBy('isbn', 'isbn-b4')).toBeNull();
		expect((await books.findBy('isbn', 'other'))!.id).toBe('b4');
	});

	it('makes every cached row a miss after a write without events', async () => {
		const books = new BookRepository();
		const direct = new DirectRepository();
		await direct.insert(book('b5'));
		await books.find('b5');

		await direct.update('b5', { title: 'behind' });
		await books.updateAll({ isbn: 'all' });
		expect((await books.find('b5'))!.title).toBe('behind');

		await books.deleteAll();
		expect(await books.find('b5')).toBeNull();
	});

	it('forgets rows on demand, after custom writes', async () => {
		const books = new BookRepository();
		const direct = new DirectRepository();
		await direct.insert(book('b11'));
		await direct.insert(book('b12'));
		await books.find('b11');
		await books.find('b12');
		await direct.update('b11', { title: 'one' });
		await direct.update('b12', { title: 'two' });

		await books.forget('b11');
		expect((await books.find('b11'))!.title).toBe('one');
		expect((await books.find('b12'))!.title).toBe('Book b12');

		await books.forgetAll();
		expect((await books.find('b12'))!.title).toBe('two');
	});

	it('keeps tenants apart', async () => {
		const books = new BookRepository();
		await new DirectRepository().insert(book('b6'));
		await books.find('b6');
		await withTenant('acme', async () => {
			expect(await books.find('b6')).not.toBeNull();
			await books.deleteAll();
		});
		await new DirectRepository().update('b6', { title: 'public' });
		// The tenant's write leaves the public entry as it was.
		expect((await books.find('b6'))!.title).toBe('Book b6');
	});

	it('merges the own options of a class over the defaults, and honours false', async () => {
		const direct = new DirectRepository();
		await direct.insert(book('b7'));
		const short = new ShortRepository();
		await short.find('b7');
		await direct.update('b7', { title: 'later' });
		await Bun.sleep(40);
		expect((await short.find('b7'))!.title).toBe('later');
	});

	it('does not cache without defaults nor own options', async () => {
		Service.remove(REPOSITORY_CACHE_SERVICE);
		const books = new BookRepository();
		const direct = new DirectRepository();
		await direct.insert(book('b8'));
		await books.find('b8');
		await direct.update('b8', { title: 'fresh' });
		expect((await books.find('b8'))!.title).toBe('fresh');
	});

	it('reads past the cache in a unit of work, and forgets once it commits', async () => {
		Service.instance(
			DATABASE_TRANSACTION_SERVICE,
			withUnitOfWork((callback) => callback())
		);
		const books = new BookRepository();
		const direct = new DirectRepository();
		await direct.insert(book('b9'));
		await books.find('b9');
		await direct.update('b9', { title: 'behind' });

		await UnitOfWork.run(async () => {
			expect((await books.find('b9'))!.title).toBe('behind');
		});
		expect((await books.find('b9'))!.title).toBe('Book b9');

		await UnitOfWork.run(async () => {
			await books.update('b9', { title: 'committed' });
		});
		expect((await books.find('b9'))!.title).toBe('committed');
	});

	it('reads the database when the cache fails', async () => {
		Service.remove(MEMORY_CACHE_SERVICE);
		Service.instance(MEMORY_CACHE_SERVICE, {
			tags: () => ({
				mget: async () => {
					throw new Error('down');
				},
				set: async () => {
					throw new Error('down');
				},
				del: async () => {
					throw new Error('down');
				}
			})
		});
		const books = new BookRepository();
		await books.insert(book('b10'));
		expect((await books.find('b10'))!.id).toBe('b10');
		expect(await books.update('b10', { title: 'x' })).not.toBeNull();
	});
});
