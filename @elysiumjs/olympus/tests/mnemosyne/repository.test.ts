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

import { afterEach, describe, expect, it } from 'bun:test';

import { DATABASE_TRANSACTION_SERVICE, Service } from '../../src/index';
import {
	AbstractModel,
	Listing,
	MemoryDatabase,
	MemoryModel,
	MissingRepositoryAdapterError,
	Pruner,
	Repository,
	RepositoryKeyError,
	UnitOfWork,
	withTenant,
	withUnitOfWork
} from '../../src/mnemosyne';

type Book = { id: string; title: string; pages: number; author: string };

class BookModel extends MemoryModel<Book>('books') {}
class BookRepository extends Repository(BookModel) {}

class ArchiveRepository extends Repository(BookModel) {
	public static override readonly connection = 'archive';
}

type Follow = { userId: string; creatorId: string; since: number };
class FollowModel extends MemoryModel<Follow>('follows', { key: ['userId', 'creatorId'] }) {}
class FollowRepository extends Repository(FollowModel) {}

class KeylessModel extends MemoryModel<{ slug: string }>('keyless', { key: [] }) {}
class KeylessRepository extends Repository(KeylessModel) {}
class SlugRepository extends Repository(KeylessModel, { key: ['slug'] }) {}

const seed = async (repository = new BookRepository()) => {
	await repository.insert({ id: 'b1', title: 'Dune', pages: 412, author: 'Herbert' });
	await repository.insert({ id: 'b2', title: 'Emma', pages: 474, author: 'Austen' });
	await repository.insert({ id: 'b3', title: 'Dracula', pages: 418, author: 'Stoker' });
	return repository;
};

afterEach(() => {
	MemoryDatabase.reset();
	Service.remove(DATABASE_TRANSACTION_SERVICE);
});

describe('Repository on the memory backend', () => {
	it('inserts, finds, updates, deletes and checks rows', async () => {
		const repository = await seed();
		expect(await repository.find('b1')).toEqual({
			id: 'b1',
			title: 'Dune',
			pages: 412,
			author: 'Herbert'
		});
		expect(await repository.find('nope')).toBeNull();
		expect(await repository.findBy('title', 'Emma')).toMatchObject({ id: 'b2' });
		expect(await repository.findBy('title', 'Nope')).toBeNull();
		expect(await repository.update('b1', { pages: 500 })).toMatchObject({ pages: 500 });
		expect(await repository.update('nope', { pages: 1 })).toBeNull();
		expect(await repository.exists('b2')).toBe(true);
		expect(await repository.delete('b2')).toMatchObject({ id: 'b2' });
		expect(await repository.delete('b2')).toBeNull();
		expect(await repository.exists('b2')).toBe(false);
		expect((await repository.all()).map((book) => book.id)).toEqual(['b1', 'b3']);
	});

	it('gives a single-column key a UUID when the row has none', async () => {
		const book = await new BookRepository().insert({ title: 'Ulysses', pages: 730 });
		expect(book.id).toMatch(/^[0-9a-f-]{36}$/);
	});

	it('copies rows in and out', async () => {
		const repository = await seed();
		const book = (await repository.find('b1'))!;
		book.title = 'changed';
		expect((await repository.find('b1'))!.title).toBe('Dune');
	});

	it('updates and deletes every row', async () => {
		const repository = await seed();
		expect((await repository.updateAll({ author: 'Anon' })).map((b) => b.author)).toEqual([
			'Anon',
			'Anon',
			'Anon'
		]);
		expect(await repository.deleteAll()).toHaveLength(3);
		expect(await repository.all()).toEqual([]);
	});

	it('keeps the rows of each connection apart', async () => {
		await seed();
		expect(await new ArchiveRepository().all()).toEqual([]);
		expect(new ArchiveRepository().db).toBe(MemoryDatabase.connection('archive'));
		expect(await new ArchiveRepository().withConnection(async (db) => db)).toBe(
			MemoryDatabase.connection('archive')
		);
	});

	it('keeps the rows of each tenant apart for a tenant-aware model', async () => {
		class TenantBook extends MemoryModel<Book>('tenant_books', { supportTenancy: true }) {}
		class TenantBookRepository extends Repository(TenantBook) {}
		const repository = new TenantBookRepository();
		await repository.insert({ id: 'x', title: 'Public', pages: 1, author: 'a' });
		expect(TenantBook.table.name).toBe('tenant_books');
		expect((await repository.all()).length).toBe(1);
		expect(TenantBook.supportTenancy).toBe(true);
		const tenantTable = BookModel.adapter.createTenantTable(TenantBook.table, 'acme');
		expect(tenantTable.name).toBe('acme.tenant_books');
		expect(withTenant('acme', () => 1)).toBe(1);
	});

	it('deletes the rows of a scope, at most a limit of them', async () => {
		const repository = await seed();
		expect(await repository.deleteWhere((book) => book.pages > 415, 1)).toBe(1);
		expect(await repository.deleteWhere((book) => book.pages > 415)).toBe(1);
		expect((await repository.all()).map((book) => book.id)).toEqual(['b1']);
	});
});

describe('Repository keys', () => {
	it('takes an object of the values of a key that spans several columns', async () => {
		const repository = new FollowRepository();
		await repository.insert({ userId: 'u1', creatorId: 'c1', since: 1 });
		expect(await repository.find({ userId: 'u1', creatorId: 'c1' })).toMatchObject({ since: 1 });
		await expect(repository.find('u1')).rejects.toBeInstanceOf(RepositoryKeyError);
		await expect(repository.find({ userId: 'u1' })).rejects.toThrow('misses creatorId');
	});

	it('refuses keys for a table without one, unless the repository names them', async () => {
		await expect(new KeylessRepository().find('x')).rejects.toThrow('has no primary key');
		const slugs = new SlugRepository();
		await slugs.insert({ slug: 'dune' });
		expect(await slugs.find('dune')).toEqual({ slug: 'dune' });
	});

	it('needs a model with a repository adapter', async () => {
		class Bare extends AbstractModel(
			'bare',
			{},
			{ getTableName: () => 'bare', getColumns: () => [], createTenantTable: (t) => t },
			{}
		) {}
		class BareRepository extends Repository(Bare) {}
		await expect(new BareRepository().all()).rejects.toBeInstanceOf(MissingRepositoryAdapterError);
	});
});

describe('Repository listing', () => {
	const spec = {
		pagination: 'cursor',
		filters: { title: ['contains'], pages: ['gte', 'in'], author: ['eq'] },
		sort: ['pages', 'title'],
		defaultSort: 'pages',
		limit: { default: 2, max: 10 },
		types: { pages: 'number' }
	} as const;

	it('pages with a cursor, in sort order', async () => {
		const repository = await seed();
		const first = await repository.list(Listing.parse(spec, {}));
		expect(first.data.map((book) => book.id)).toEqual(['b1', 'b3']);
		expect(first.nextCursor).toBeString();
		const second = await repository.list(Listing.parse(spec, { cursor: first.nextCursor! }));
		expect(second.data.map((book) => book.id)).toEqual(['b2']);
		expect(second.nextCursor).toBeNull();
	});

	it('sorts descending', async () => {
		const repository = await seed();
		const page = await repository.list(Listing.parse(spec, { sort: '-pages', limit: '3' }));
		expect(page.data.map((book) => book.id)).toEqual(['b2', 'b3', 'b1']);
	});

	it('filters, and counts the rows a query matches', async () => {
		const repository = await seed();
		const query = Listing.parse(spec, { 'filter[title][contains]': 'd' });
		const page = await repository.list(query);
		expect(page.data.map((book) => book.id)).toEqual(['b1', 'b3']);
		expect(await repository.count(query)).toBe(2);
		expect(await repository.count(Listing.parse(spec, { 'filter[pages][gte]': '418' }))).toBe(2);
		expect(await repository.count(Listing.parse(spec, { 'filter[pages][in]': '412,474' }))).toBe(2);
		expect(await repository.count()).toBe(3);
	});

	it('pages by offset with the total, and applies a scope', async () => {
		const repository = await seed();
		const offset = { ...spec, pagination: 'offset' } as const;
		const page = await repository.list(Listing.parse(offset, { page: '2' }));
		expect(page).toMatchObject({ page: 2, limit: 2, total: 3 });
		expect(page.data.map((book) => book.id)).toEqual(['b2']);
		const scoped = await repository.list(
			Listing.parse(offset, {}),
			(book: Book) => book.author !== 'Herbert'
		);
		expect(scoped.total).toBe(2);
	});
});

describe('Repository events', () => {
	it('lets a creating listener change the data or refuse the write', async () => {
		class EventBookRepository extends Repository(BookModel) {}
		const off = EventBookRepository.on('creating', ({ data }) => {
			if (data.title === 'Forbidden') return new Error('refused');
			data.author ??= 'Unknown';
		});
		const repository = new EventBookRepository();
		expect(await repository.insert({ id: 'x', title: 'Dune', pages: 1 })).toMatchObject({
			author: 'Unknown'
		});
		await expect(repository.insert({ id: 'y', title: 'Forbidden', pages: 1 })).rejects.toThrow(
			'refused'
		);
		expect(await repository.exists('y')).toBe(false);
		off();
		expect(await repository.insert({ id: 'z', title: 'Forbidden', pages: 1 })).toMatchObject({
			id: 'z'
		});
	});

	it('runs the -ed listeners once the unit of work commits', async () => {
		Service.instance(
			DATABASE_TRANSACTION_SERVICE,
			withUnitOfWork((callback) => callback())
		);
		class CommitBookRepository extends Repository(BookModel) {}
		const events: string[] = [];
		CommitBookRepository.on('created', ({ row }) => void events.push(`created:${row.id}`));
		CommitBookRepository.on('updated', ({ row }) => void events.push(`updated:${row.id}`));
		CommitBookRepository.on('deleted', ({ row }) => void events.push(`deleted:${row.id}`));
		const repository = new CommitBookRepository();

		await UnitOfWork.run(async () => {
			await repository.insert({ id: 'a', title: 'A', pages: 1, author: 'x' });
			await repository.update('a', { pages: 2 });
			await repository.delete('a');
			events.push('work done');
		});
		expect(events).toEqual(['work done', 'created:a', 'updated:a', 'deleted:a']);
	});

	it('runs the -ed listeners right away when the repository opts out', async () => {
		Service.instance(
			DATABASE_TRANSACTION_SERVICE,
			withUnitOfWork((callback) => callback())
		);
		class EagerBookRepository extends Repository(BookModel) {
			public static override readonly afterCommit = false;
		}
		const events: string[] = [];
		EagerBookRepository.on('created', ({ row }) => void events.push(row.id));
		await UnitOfWork.run(async () => {
			await new EagerBookRepository().insert({ id: 'e', title: 'E', pages: 1, author: 'x' });
			events.push('work done');
		});
		expect(events).toEqual(['e', 'work done']);
	});

	it('lets updating and deleting listeners refuse the write', async () => {
		class GuardedRepository extends Repository(BookModel) {}
		GuardedRepository.on('updating', ({ data }) =>
			data.pages !== undefined && data.pages < 0 ? new Error('negative') : undefined
		);
		GuardedRepository.on('deleting', ({ key }) => (key === 'b1' ? new Error('kept') : undefined));
		const repository = await seed(new GuardedRepository());
		await expect(repository.update('b1', { pages: -1 })).rejects.toThrow('negative');
		await expect(repository.delete('b1')).rejects.toThrow('kept');
		expect(await repository.delete('b2')).toMatchObject({ id: 'b2' });
	});

	it('calls the methods of an observer, resolved from the container when registered', async () => {
		class ObservedRepository extends Repository(BookModel) {}
		const calls: string[] = [];

		@Repository.observer(ObservedRepository)
		class BookObserver {
			public creating({ data }: { data: Partial<Book> }) {
				calls.push(`creating:${data.id}`);
				if (data.title === 'No') return new Error('no');
			}

			public created({ row }: { row: Book }) {
				calls.push(`created:${row.id}`);
			}

			public deleted({ row }: { row: Book }) {
				calls.push(`deleted:${row.id}`);
			}
		}

		@Service.register()
		class InjectedObserver {
			public static instances = 0;

			constructor() {
				InjectedObserver.instances++;
			}

			public updated() {
				calls.push('updated');
			}
		}
		Repository.observer(ObservedRepository)(InjectedObserver);

		const repository = new ObservedRepository();
		await repository.insert({ id: 'o', title: 'Yes', pages: 1, author: 'x' });
		await expect(
			repository.insert({ id: 'p', title: 'No', pages: 1, author: 'x' })
		).rejects.toThrow('no');
		await repository.update('o', { pages: 2 });
		await repository.delete('o');
		expect(calls).toEqual(['creating:o', 'created:o', 'creating:p', 'updated', 'deleted:o']);
		expect(BookObserver).toBeFunction();
		expect(InjectedObserver.instances).toBe(1);
		Service.remove(InjectedObserver);
	});
});

describe('Pruner', () => {
	it('deletes the rows of its scope, chunk by chunk', async () => {
		const repository = await seed();
		class PruneLong extends Pruner(BookModel) {
			protected get prunable() {
				return (book: Book) => book.pages > 400;
			}

			protected override get chunkSize() {
				return 2;
			}
		}
		const job = new PruneLong();
		await job.run();
		expect(job.pruned).toBe(3);
		expect(await repository.all()).toEqual([]);
	});

	it('gives each chunk to its pruning() hook before it deletes it', async () => {
		const repository = await seed();
		const seen: string[][] = [];
		class PruneWithHook extends Pruner(BookModel) {
			protected get prunable() {
				return (book: Book) => book.author !== 'Austen';
			}

			protected override get chunkSize() {
				return 1;
			}

			protected override pruning(rows: Book[]) {
				seen.push(rows.map((row) => row.id));
			}
		}
		const job = new PruneWithHook();
		await job.run();
		expect(seen).toEqual([['b1'], ['b3']]);
		expect(job.pruned).toBe(2);
		expect((await repository.all()).map((book) => book.id)).toEqual(['b2']);
	});

	it('needs a key for its pruning() hook', async () => {
		class PruneKeyless extends Pruner(KeylessModel) {
			protected get prunable() {
				return () => true;
			}

			protected override pruning() {}
		}
		const job = new PruneKeyless();
		await job.run();
		expect(job.lastError?.message).toContain('has no primary key');
	});
});
