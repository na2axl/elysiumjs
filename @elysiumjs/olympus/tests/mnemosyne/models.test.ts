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

import { describe, expect, it } from 'bun:test';

import { Json } from '../../src/index';
import {
	DuplicateModelError,
	Listing,
	MemoryModel,
	ModelResource,
	Models,
	Pruner,
	Repository,
	UnknownModelError
} from '../../src/mnemosyne';
import { makeCacheInterface } from '../../src/mnemosyne/cache';

type Article = {
	id: string;
	title: string;
	body: string;
	secret: string;
	publishedAt: Date | null;
};

class ArticleModel extends MemoryModel<Article>('articles') {
	public static override readonly hidden = ['secret'] as const;
	public static override readonly appends = ['isPublished', 'words'] as const;

	public get isPublished(): boolean {
		return this.publishedAt !== null;
	}

	public get words(): number {
		return this.body.split(/\s+/).length;
	}
}

class ArticleRepository extends Repository(ArticleModel) {
	public published() {
		return this.hydrate([
			{ id: 'raw', title: 'Raw', body: 'a b', secret: 's', publishedAt: new Date(0) }
		]);
	}
}

const article = (id: string, publishedAt: Date | null = new Date('2026-01-02T03:04:05.000Z')) => ({
	id,
	title: `Title ${id}`,
	body: 'one two three',
	secret: `secret ${id}`,
	publishedAt
});

describe('Model instances', () => {
	it('answers instances of the model from every reading and writing method', async () => {
		const repository = new ArticleRepository();
		const inserted = await repository.insert(article('a1'));
		expect(inserted).toBeInstanceOf(ArticleModel);
		expect(inserted.isPublished).toBe(true);
		expect(inserted.words).toBe(3);

		expect(await repository.find('a1')).toBeInstanceOf(ArticleModel);
		expect(await repository.findBy('title', 'Title a1')).toBeInstanceOf(ArticleModel);
		expect((await repository.all())[0]).toBeInstanceOf(ArticleModel);
		expect(await repository.update('a1', { title: 'New' })).toBeInstanceOf(ArticleModel);

		const page = await repository.list(Listing.parse(Listing.define(ArticleModel, {}), {}));
		expect(page.data[0]).toBeInstanceOf(ArticleModel);

		expect(await repository.delete('a1')).toBeInstanceOf(ArticleModel);
		expect(await repository.find('a1')).toBeNull();
	});

	it('hydrates the rows of custom queries', () => {
		const [row] = new ArticleRepository().published();
		expect(row).toBeInstanceOf(ArticleModel);
		expect(ArticleModel.hydrate(null)).toBeNull();
		const instance = ArticleModel.hydrate(article('a2'));
		expect(ArticleModel.hydrate(instance)).toBe(instance);
	});

	it('writes its columns and appends, without the hidden columns, as JSON', () => {
		const instance = ArticleModel.hydrate(article('a3'));
		expect(JSON.parse(JSON.stringify(instance))).toEqual({
			id: 'a3',
			title: 'Title a3',
			body: 'one two three',
			publishedAt: '2026-01-02T03:04:05.000Z',
			isPublished: true,
			words: 3
		});
		expect(Models.attributes(instance)).toEqual(article('a3'));
	});

	it('is named after its table by default', () => {
		expect(ArticleModel.modelName).toBe('articles');
		expect(Models.find('articles')).toBe(ArticleModel);
		expect(Models.isInstance(ArticleModel.hydrate(article('a4')))).toBe(true);
		expect(Models.isInstance(article('a4'))).toBe(false);
	});

	it('refuses two model classes with the same name', () => {
		class Other extends MemoryModel<Article>('articles') {}
		expect(() => Models.register(Other)).toThrow(DuplicateModelError);

		class Admin extends ArticleModel {}
		expect(() => Admin.hydrate(article('x'))).toThrow(/ArticleModel and Admin/);

		class Renamed extends MemoryModel<Article>('articles') {
			public static override readonly modelName = 'renamed-articles';
		}
		expect(Models.register(Renamed)).toBe(Renamed);
	});
});

describe('ModelSerializer', () => {
	it('reads model instances back from Json as instances of the same class', () => {
		const instance = ArticleModel.hydrate(article('a5'));
		const back = Json.parse<{ items: ArticleModel[] }>(Json.stringify({ items: [instance] }));
		expect(back.items[0]).toBeInstanceOf(ArticleModel);
		expect(back.items[0]!.publishedAt).toBeInstanceOf(Date);
		expect(back.items[0]!.secret).toBe('secret a5');
		expect(back.items[0]!.isPublished).toBe(true);
		expect(Json.survives(instance)).toBe(true);
	});

	it('throws when the model is not registered', () => {
		const text = JSON.stringify({ $type: 'model', $value: { model: 'nowhere', attributes: {} } });
		expect(() => Json.parse(text)).toThrow(UnknownModelError);
	});
});

describe('Cache with models', () => {
	it('reads back model instances and dates, as copies', async () => {
		const cache = makeCacheInterface(() => new Map() as never);
		const instance = ArticleModel.hydrate(article('a6'));
		await cache.set('article', instance);

		const first = await cache.get<ArticleModel>('article');
		expect(first).toBeInstanceOf(ArticleModel);
		expect(first!.publishedAt).toBeInstanceOf(Date);
		expect(first).not.toBe(instance);

		first!.title = 'changed';
		expect((await cache.get<ArticleModel>('article'))!.title).toBe('Title a6');
	});

	it('writes the store with Json', async () => {
		const store = new Map<string, unknown>();
		const cache = makeCacheInterface(() => store as never);
		await cache.set('at', new Date('2026-01-01T00:00:00.000Z'));
		const [raw] = [...store.values()];
		expect(raw).toContain('"$type":"date"');
	});
});

describe('ModelResource with models', () => {
	it('hides the hidden columns of the model and exposes its appends', () => {
		class Typed extends MemoryModel<Article>('typed-articles') {
			public static override readonly hidden = ['secret'] as const;
			public static override readonly appends = ['isPublished'] as const;
		}
		Object.defineProperty(Typed, 'selectSchema', {
			value: { properties: { id: { type: 'string' }, secret: { type: 'string' } } }
		});
		const schema = ModelResource(Typed) as unknown as {
			properties: Record<string, Record<string | symbol, unknown>>;
		};
		expect(Object.keys(schema.properties)).toEqual(['id', 'secret', 'isPublished']);
	});
});

describe('Model registry', () => {
	it('replaces a class evaluated again, and forgets classes', () => {
		const first = class Reloaded extends MemoryModel<Article>('reloaded') {};
		const second = class Reloaded extends MemoryModel<Article>('reloaded') {};
		Models.register(first);
		expect(Models.register(second)).toBe(second);
		expect(Models.find('reloaded')).toBe(second);

		Models.unregister('reloaded');
		expect(Models.find('reloaded')).toBeUndefined();
	});
});

describe('Hydration', () => {
	it('keeps the columns a subclass names again as class fields', () => {
		class Fielded extends MemoryModel<{ id: string; name: string }>('fielded') {
			public name!: string;
			public extra = 1;
		}
		const instance = Fielded.hydrate({ id: '1', name: 'a' });
		expect(instance.name).toBe('a');
		expect(instance.extra).toBe(1);
	});

	it('writes a __proto__ column as a plain property', () => {
		const crafted = JSON.parse(
			'{"$type":"model","$value":{"model":"articles","attributes":{"id":"q","__proto__":{"evil":1}}}}'
		);
		const decoded = Json.decode<ArticleModel>(crafted);
		expect(decoded).toBeInstanceOf(ArticleModel);
		expect((decoded as unknown as { evil?: number }).evil).toBeUndefined();
	});

	it('lets a column shadow a getter of the same name', () => {
		const instance = ArticleModel.hydrate({ ...article('g'), words: 99 });
		expect(instance.words).toBe(99);
	});
});

describe('Instances in events and pruners', () => {
	it('gives instances to the -ed listeners', async () => {
		class EventedRepository extends Repository(ArticleModel) {
			public static override readonly afterCommit = false;
		}
		const seen: unknown[] = [];
		EventedRepository.on('created', ({ row }) => {
			seen.push(row);
		});
		EventedRepository.on('updated', ({ row }) => {
			seen.push(row);
		});
		EventedRepository.on('deleted', ({ row }) => {
			seen.push(row);
		});
		const repository = new EventedRepository();
		await repository.insert(article('e1'));
		await repository.update('e1', { title: 'x' });
		await repository.delete('e1');
		expect(seen).toHaveLength(3);
		for (const row of seen) expect(row).toBeInstanceOf(ArticleModel);
	});

	it('gives instances to the pruning() hook, and from bulk methods', async () => {
		const repository = new ArticleRepository();
		await repository.insert(article('p1', null));
		await repository.insert(article('p2', null));
		expect((await repository.updateAll({ title: 'all' }))[0]).toBeInstanceOf(ArticleModel);

		const seen: unknown[] = [];
		class PruneDrafts extends Pruner(ArticleModel) {
			protected get prunable() {
				return (row: Article) => row.publishedAt === null;
			}

			protected override pruning(rows: ArticleModel[]) {
				seen.push(...rows);
			}
		}
		await new PruneDrafts().run();
		expect(seen.length).toBeGreaterThan(0);
		for (const row of seen) expect(row).toBeInstanceOf(ArticleModel);
		expect(Array.isArray(await repository.deleteAll())).toBe(true);
	});

	it('keeps the pagination of listed pages', async () => {
		const repository = new ArticleRepository();
		await repository.insert(article('l1'));
		const page = await repository.list(
			Listing.parse(Listing.define(ArticleModel, { pagination: 'offset' }), {})
		);
		expect(page.data[0]).toBeInstanceOf(ArticleModel);
		expect('total' in page).toBe(true);
	});
});

describe('Byte arrays in the cache', () => {
	it('reads back byte arrays and buffers', async () => {
		const cache = makeCacheInterface(() => new Map() as never);
		await cache.set('bytes', new Uint8Array([1, 2, 255]));
		await cache.set('buffer', Buffer.from('hi'));
		const bytes = await cache.get<Uint8Array>('bytes');
		expect(bytes).toBeInstanceOf(Uint8Array);
		expect([...bytes!]).toEqual([1, 2, 255]);
		const buffer = await cache.get<Buffer>('buffer');
		expect(Buffer.isBuffer(buffer)).toBe(true);
		expect(buffer!.toString()).toBe('hi');
	});
});
