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

import {
	Application,
	DATABASE_TRANSACTION_SERVICE,
	Module,
	ModuleContext,
	Service
} from '../../src/index';
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

	it('needs a scope to delete by one', async () => {
		const repository = await seed();
		await expect(repository.deleteWhere(undefined as never)).rejects.toThrow('use deleteAll()');
		expect(await repository.count()).toBe(3);
	});

	it('refuses a second row with the same key', async () => {
		const repository = await seed();
		await expect(
			repository.insert({ id: 'b1', title: 'Again', pages: 1, author: 'x' })
		).rejects.toThrow('already has a row with the key');
		await expect(repository.update('b2', { id: 'b1' })).rejects.toThrow(
			'already has a row with the key'
		);
		expect(await repository.find('b2')).toMatchObject({ title: 'Emma' });
	});

	it('compares values strictly, and dates by time', async () => {
		type Event = { id: string; at: Date; tags: string[]; code: unknown };
		class EventModel extends MemoryModel<Event>('events') {}
		class EventRepository extends Repository(EventModel) {}
		const repository = new EventRepository();
		await repository.insert({ id: 'e1', at: new Date('2026-01-01'), tags: ['a'], code: 10 });
		await repository.insert({ id: 'e2', at: new Date('2026-02-01'), tags: ['b'], code: '10' });

		expect(await repository.findBy('at', new Date('2026-01-01'))).toMatchObject({ id: 'e1' });
		expect(await repository.findBy('tags', ['b'])).toMatchObject({ id: 'e2' });
		expect(await repository.findBy('code', '10')).toMatchObject({ id: 'e2' });
		expect(await repository.findBy('code', 10)).toMatchObject({ id: 'e1' });
	});

	it('sorts missing values last in ascending order and first in descending order', async () => {
		type Score = { id: string; points: number | null };
		class ScoreModel extends MemoryModel<Score>('scores') {}
		class ScoreRepository extends Repository(ScoreModel) {}
		const repository = new ScoreRepository();
		for (const [id, points] of [
			['a', 9],
			['b', null],
			['c', 100]
		] as const) {
			await repository.insert({ id, points });
		}
		const spec = { pagination: 'cursor', sort: ['points'], limit: { default: 5 } } as const;
		const ids = async (sort: string) =>
			(await repository.list(Listing.parse(spec, { sort }))).data.map((row) => row.id);
		expect(await ids('points')).toEqual(['a', 'c', 'b']);
		expect(await ids('-points')).toEqual(['b', 'c', 'a']);
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

	it('takes a value that is not a plain object as the value of a single-column key', async () => {
		type Day = { day: Date; visits: number };
		class DayModel extends MemoryModel<Day>('days', { key: ['day'] }) {}
		class DayRepository extends Repository(DayModel) {}
		const repository = new DayRepository();
		await repository.insert({ day: new Date('2026-03-01'), visits: 3 });
		expect(await repository.find(new Date('2026-03-01') as never)).toMatchObject({ visits: 3 });
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

	it('calls the methods of an observer built once when it is not a service', async () => {
		class ObservedRepository extends Repository(BookModel) {}
		const calls: string[] = [];

		@Repository.observer(ObservedRepository)
		class BookObserver {
			public static instances = 0;

			constructor() {
				BookObserver.instances++;
			}

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

		const repository = new ObservedRepository();
		await repository.insert({ id: 'o', title: 'Yes', pages: 1, author: 'x' });
		await expect(
			repository.insert({ id: 'p', title: 'No', pages: 1, author: 'x' })
		).rejects.toThrow('no');
		await repository.delete('o');
		expect(calls).toEqual(['creating:o', 'created:o', 'creating:p', 'deleted:o']);
		expect(BookObserver.instances).toBe(1);
	});

	it('resolves an observer service from the container, in the module that declares it', async () => {
		class ObservedRepository extends Repository(BookModel) {
			public static override readonly afterCommit = false;
		}
		const calls: string[] = [];

		@Service.register({ name: 'test.audit' })
		class Audit {
			public record(entry: string) {
				calls.push(entry);
			}
		}

		@Service.register()
		@Repository.observer(ObservedRepository)
		class AuditObserver {
			constructor(@Service.inject('test.audit') private readonly audit: Audit) {}

			public updated({ row }: { row: Book }) {
				this.audit.record(`updated:${row.id}:${ModuleContext.current()?.id}`);
			}
		}

		@Module.register({ services: [Audit, AuditObserver] })
		class AuditModule extends Module {}

		const repository = await seed(new ObservedRepository());
		await expect(repository.update('b1', { pages: 1 })).rejects.toThrow(
			'is registered as a service but is not in the container'
		);

		const app = await Application.testing({ modules: [AuditModule] });
		try {
			await repository.update('b1', { pages: 2 });
			expect(calls).toEqual([`updated:b1:${Service.ownersOf(AuditObserver)[0]!.id}`]);
		} finally {
			await app.shutdown();
		}
	});

	it('runs the listeners of a parent repository class for its subclasses', async () => {
		class ParentRepository extends Repository(BookModel) {}
		class ChildRepository extends ParentRepository {}
		const calls: string[] = [];
		ParentRepository.on('created', ({ row }) => void calls.push(`parent:${row.id}`));
		ChildRepository.on('created', ({ row }) => void calls.push(`child:${row.id}`));

		await new ChildRepository().insert({ id: 'c', title: 'C', pages: 1, author: 'x' });
		await new ParentRepository().insert({ id: 'p', title: 'P', pages: 1, author: 'x' });
		expect(calls).toEqual(['parent:c', 'child:c', 'parent:p']);
	});

	it('runs the -ing listeners in order, and stops at the first refusal', async () => {
		class OrderedRepository extends Repository(BookModel) {}
		const calls: string[] = [];
		OrderedRepository.on('creating', async ({ data }) => {
			await new Promise((resolve) => setTimeout(resolve, 5));
			calls.push('first');
			data.author = 'First';
		});
		OrderedRepository.on('creating', ({ data }) => {
			calls.push(`second:${data.author}`);
			if (data.title === 'No') return new Error('refused by second');
		});
		OrderedRepository.on('creating', () => void calls.push('third'));
		const repository = new OrderedRepository();

		expect(await repository.insert({ id: 'a', title: 'Yes', pages: 1 })).toMatchObject({
			author: 'First'
		});
		await expect(repository.insert({ id: 'b', title: 'No', pages: 1 })).rejects.toThrow(
			'refused by second'
		);
		expect(calls).toEqual(['first', 'second:First', 'third', 'first', 'second:First']);
	});

	it('throws the error a listener throws, as it is', async () => {
		class ThrowingRepository extends Repository(BookModel) {
			public static override readonly afterCommit = false;
		}
		ThrowingRepository.on('creating', ({ data }) => {
			if (data.title === 'Boom') throw new TypeError('boom');
		});
		ThrowingRepository.on('created', ({ row }) => {
			if (row.title === 'Late') throw new RangeError('late');
		});
		const repository = new ThrowingRepository();

		await expect(repository.insert({ id: 'a', title: 'Boom', pages: 1 })).rejects.toBeInstanceOf(
			TypeError
		);
		await expect(repository.insert({ id: 'b', title: 'Late', pages: 1 })).rejects.toBeInstanceOf(
			RangeError
		);
	});

	it('skips the -ed listeners when the unit of work rolls back', async () => {
		Service.instance(
			DATABASE_TRANSACTION_SERVICE,
			withUnitOfWork((callback) => callback())
		);
		class RolledBackRepository extends Repository(BookModel) {}
		const events: string[] = [];
		RolledBackRepository.on('created', ({ row }) => void events.push(row.id));

		await expect(
			UnitOfWork.run(async () => {
				await new RolledBackRepository().insert({ id: 'r', title: 'R', pages: 1, author: 'x' });
				throw new Error('rollback');
			})
		).rejects.toThrow('rollback');
		expect(events).toEqual([]);
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

	it('prunes nothing when its scope is undefined', async () => {
		const repository = await seed();
		class PruneNothing extends Pruner(BookModel) {
			protected get prunable() {
				return undefined;
			}
		}
		const job = new PruneNothing();
		await job.run();
		expect(job.pruned).toBe(0);
		expect(await repository.count()).toBe(3);
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
