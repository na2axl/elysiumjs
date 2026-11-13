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

/** Does not read through the cache, but forgets its writes in it. */
class DirectRepository extends Repository(BookModel) {
	public static override readonly cache = false;
}

/** Changes a row behind the cache's back, as another process would. */
const behind = (id: string, data: Partial<Book>) =>
	BookModel.adapter!.repository!.update(
		{ table: BookModel.table, model: 'BookModel', connection: 'default', key: ['id'] },
		{ id },
		data
	);

class TenantBookModel extends MemoryModel<Book>('cached-tenant-books', { supportTenancy: true }) {}
class TenantBookRepository extends Repository(TenantBookModel) {}

class PairModel extends MemoryModel<{ a: string; b: string; label: string }>('cached-pairs', {
	key: ['a', 'b']
}) {}
class PairRepository extends Repository(PairModel) {}

class MissingStoreRepository extends Repository(BookModel) {
	public static override readonly cache = { store: 'nowhere' };
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
		await behind('b1', { title: 'behind the cache' });
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
		// The second lookup reads the row by its key, which caches it.
		expect((await books.findBy('isbn', 'isbn-b4'))!.title).toBe('Book b4');
		await behind('b4', { title: 'behind' });
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

		await behind('b5', { title: 'behind' });
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
		await behind('b11', { title: 'one' });
		await behind('b12', { title: 'two' });

		await books.forgetCached('b11');
		expect((await books.find('b11'))!.title).toBe('one');
		expect((await books.find('b12'))!.title).toBe('Book b12');

		await books.forgetAllCached();
		expect((await books.find('b12'))!.title).toBe('two');
	});

	it('keeps the tenants of a tenant-aware model apart', async () => {
		const books = new TenantBookRepository();
		await books.insert(book('t1'));
		await books.find('t1');
		// Tables are not split by tenant outside an application: the cache entries are.
		await withTenant('acme', () => books.deleteAll());
		// The tenant's write leaves the public entry as it was.
		expect((await books.find('t1'))!.title).toBe('Book t1');
	});

	it('shares the rows of a model without tenancy between tenants', async () => {
		const books = new BookRepository();
		await books.insert(book('s1'));
		await books.find('s1');
		await withTenant('acme', () => books.update('s1', { title: 'from acme' }));
		expect((await books.find('s1'))!.title).toBe('from acme');
	});

	it('forgets the writes of a repository that does not read through the cache', async () => {
		const books = new BookRepository();
		await books.insert(book('w1'));
		await books.find('w1');
		await new DirectRepository().update('w1', { title: 'direct' });
		// DirectRepository forgets in the default cache, which BookRepository reads.
		expect((await books.find('w1'))!.title).toBe('direct');
	});

	it('never keeps a row a read loaded while a write changed it', async () => {
		const books = new BookRepository();
		await books.insert(book('r1'));
		let release!: () => void;
		const gate = new Promise<void>((resolve) => (release = resolve));
		const original = (books as unknown as { constructor: typeof BookRepository }).constructor;
		// A read that loads the row, then waits while a write changes it.
		const slowRead = (async () => {
			const cache = await import('../../src/mnemosyne/repository-cache');
			const reading = cache.RepositoryCache.reading(original, BookModel, 'default')!;
			return reading.find({ id: 'r1' }, async () => {
				const row = await new DirectRepository().find('r1');
				await gate;
				return row;
			});
		})();
		await Bun.sleep(5);
		await books.update('r1', { title: 'written' });
		release();
		expect((await slowRead)!.title).toBe('Book r1');
		expect((await books.find('r1'))!.title).toBe('written');
	});

	it('forgets rows by composite keys, and after deleteWhere()', async () => {
		const pairs = new PairRepository();
		await pairs.insert({ a: '1', b: '2', label: 'x' });
		await pairs.find({ a: '1', b: '2' });
		await pairs.update({ a: '1', b: '2' }, { label: 'y' });
		expect((await pairs.find({ a: '1', b: '2' }))!.label).toBe('y');

		const books = new BookRepository();
		await books.insert(book('d1'));
		await books.find('d1');
		expect(await books.deleteWhere((row: Book) => row.id === 'd1')).toBe(1);
		expect(await books.find('d1')).toBeNull();
	});

	it('reads the database when the cache it names does not exist', async () => {
		const books = new MissingStoreRepository();
		await books.insert(book('m1'));
		expect((await books.find('m1'))!.id).toBe('m1');
		expect(await books.update('m1', { title: 'x' })).not.toBeNull();
	});

	it('merges the own options of a class over the defaults, and honours false', async () => {
		const direct = new DirectRepository();
		await direct.insert(book('b7'));
		const short = new ShortRepository();
		await short.find('b7');
		await behind('b7', { title: 'later' });
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
		await behind('b9', { title: 'behind' });

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
