// Copyright (c) 2025-present Axel Nana <ax.lnana@outlook.com>. All rights reserved.
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

import type { Static } from '../../src/index';
import type { ColumnMetadata, ModelClass } from '../../src/mnemosyne/interfaces';

import { describe, expect, expectTypeOf, it } from 'bun:test';

import { DomainError } from '../../src/index';
import { createSchemaFromModel } from '../../src/mnemosyne/model';
import { Listing } from '../../src/mnemosyne/query';

const columns: ColumnMetadata[] = [
	{ name: 'id', dataType: 'number', nullable: false, hasDefault: true, isPrimaryKey: true },
	{ name: 'title', dataType: 'string', nullable: false, hasDefault: false, isPrimaryKey: false },
	{ name: 'status', dataType: 'string', nullable: false, hasDefault: false, isPrimaryKey: false },
	{ name: 'views', dataType: 'number', nullable: false, hasDefault: true, isPrimaryKey: false },
	{
		name: 'createdAt',
		dataType: 'datetime',
		nullable: false,
		hasDefault: true,
		isPrimaryKey: false
	},
	{
		name: 'archivedAt',
		dataType: 'datetime',
		nullable: true,
		hasDefault: false,
		isPrimaryKey: false
	}
];

const Post = { selectSchema: createSchemaFromModel(columns) } as unknown as ModelClass;

const spec = Listing.define(Post, {
	filters: {
		status: ['eq', 'in', 'ne'],
		views: ['gte', 'lte'],
		createdAt: ['gte', 'lt'],
		title: ['contains'],
		archived: { operators: ['isNull'], column: 'archivedAt' }
	},
	sort: ['createdAt', 'title'],
	defaultSort: '-createdAt',
	limit: { default: 10, max: 50 }
});

const problemOf = (fn: () => unknown) => {
	try {
		fn();
	} catch (error) {
		expect(error).toBeInstanceOf(DomainError);
		return error as DomainError;
	}
	throw new Error('expected a problem');
};

describe('Listing.parse', () => {
	it('reads filters with their default or named operator, typed by the model', () => {
		const query = Listing.parse(spec, {
			'filter[status]': 'draft,published',
			'filter[views][gte]': '10',
			'filter[createdAt][gte]': '2026-01-01T00:00:00.000Z',
			'filter[title][contains]': 'dune',
			'filter[archived][isNull]': 'true',
			unrelated: 'x'
		});

		expect(query.filters).toEqual([
			{ field: 'status', column: 'status', operator: 'eq', value: 'draft,published' },
			{ field: 'views', column: 'views', operator: 'gte', value: 10 },
			{
				field: 'createdAt',
				column: 'createdAt',
				operator: 'gte',
				value: new Date('2026-01-01T00:00:00.000Z')
			},
			{ field: 'title', column: 'title', operator: 'contains', value: 'dune' },
			{ field: 'archived', column: 'archivedAt', operator: 'isNull', value: true }
		]);
	});

	it('splits the values of in', () => {
		const query = Listing.parse(spec, { 'filter[status][in]': 'draft, published' });
		expect(query.filters[0]).toMatchObject({ operator: 'in', value: ['draft', 'published'] });
	});

	it('sorts by the default sort and ends with the row key as tiebreaker', () => {
		expect(Listing.parse(spec).sort).toEqual([
			{ field: 'createdAt', column: 'createdAt', direction: 'desc' },
			{ field: 'id', column: 'id', direction: 'desc' }
		]);
		expect(Listing.parse(spec, { sort: 'title,-createdAt' }).sort).toEqual([
			{ field: 'title', column: 'title', direction: 'asc' },
			{ field: 'createdAt', column: 'createdAt', direction: 'desc' },
			{ field: 'id', column: 'id', direction: 'desc' }
		]);
	});

	it('bounds the page size', () => {
		expect(Listing.parse(spec).limit).toBe(10);
		expect(Listing.parse(spec, { limit: '50' }).limit).toBe(50);
	});

	it('reports every invalid parameter in one 400 problem', () => {
		const problem = problemOf(() =>
			Listing.parse(spec, {
				'filter[secret]': 'x',
				'filter[status][gt]': 'a',
				'filter[views][gte]': 'many',
				sort: 'views',
				limit: '500',
				cursor: 'nope'
			})
		);

		expect(problem.status).toBe(400);
		expect(problem.errors).toEqual([
			{ pointer: '/query/filter[secret]', message: 'cannot filter by "secret"', code: 'filter' },
			{
				pointer: '/query/filter[status][gt]',
				message: '"gt" is not allowed on "status"',
				code: 'operator'
			},
			{ pointer: '/query/filter[views][gte]', message: 'must be a number', code: 'type' },
			{ pointer: '/query/sort', message: 'cannot sort by "views"', code: 'sort' },
			{ pointer: '/query/limit', message: 'must be a whole number from 1 to 50', code: 'limit' },
			{ pointer: '/query/cursor', message: 'is not a cursor of this listing', code: 'cursor' }
		]);
	});
});

describe('cursors', () => {
	it('round-trips the sort values of the last row, dates included', () => {
		const first = Listing.parse(spec, { limit: '2' });
		const rows = [
			{ id: 3, createdAt: new Date('2026-03-01T00:00:00.000Z') },
			{ id: 2, createdAt: new Date('2026-02-01T00:00:00.000Z') },
			{ id: 1, createdAt: new Date('2026-01-01T00:00:00.000Z') }
		];
		const page = Listing.page(first, rows);

		expect(page.data).toEqual(rows.slice(0, 2));
		expect(page.nextCursor).not.toBeNull();
		expect(Listing.parse(spec, { cursor: page.nextCursor! }).after).toEqual([
			new Date('2026-02-01T00:00:00.000Z'),
			2
		]);
	});

	it('has no next cursor on the last page', () => {
		expect(
			Listing.page(Listing.parse(spec), [{ id: 1, createdAt: new Date() }]).nextCursor
		).toBeNull();
	});

	it('refuses a cursor from a listing with other sort keys', () => {
		const cursor = Listing.cursorAfter(Listing.parse(spec, { sort: 'title,createdAt' }), {
			id: 1,
			title: 'a',
			createdAt: new Date()
		});
		expect(problemOf(() => Listing.parse(spec, { cursor })).status).toBe(400);
	});

	it('refuses a cursor whose values do not read as their sort keys', () => {
		const crafted = (values: unknown[]) =>
			Buffer.from(JSON.stringify(values)).toString('base64url');
		for (const values of [
			['not a date', 2],
			[{ $gt: 1 }, 2],
			['2026-01-01T00:00:00.000Z', 'x']
		]) {
			expect(problemOf(() => Listing.parse(spec, { cursor: crafted(values) })).status).toBe(400);
		}
	});
});

describe('Listing.schema', () => {
	it('documents the flat filter keys and the paging parameters', () => {
		const keys = Object.keys((Listing.schema(spec) as any).properties);
		expect(keys).toContain('filter[status]');
		expect(keys).toContain('filter[status][in]');
		expect(keys).toContain('filter[archived][isNull]');
		expect(keys).toEqual(expect.arrayContaining(['sort', 'cursor', 'limit', 'fields']));
	});
});

describe('Listing.Params', () => {
	it('names every parameter of the spec, as optional strings', () => {
		expectTypeOf<Listing.Params<typeof spec>>().toEqualTypeOf<{
			'filter[status]'?: string;
			'filter[status][eq]'?: string;
			'filter[status][in]'?: string;
			'filter[status][ne]'?: string;
			'filter[views]'?: string;
			'filter[views][gte]'?: string;
			'filter[views][lte]'?: string;
			'filter[createdAt]'?: string;
			'filter[createdAt][gte]'?: string;
			'filter[createdAt][lt]'?: string;
			'filter[title]'?: string;
			'filter[title][contains]'?: string;
			'filter[archived]'?: string;
			'filter[archived][isNull]'?: string;
			sort?: string;
			cursor?: string;
			limit?: string;
			fields?: string;
		}>();
	});

	it('has no sort parameter when nothing is sortable', () => {
		const unsorted = Listing.define(Post, { filters: { title: ['contains'] } });
		expectTypeOf<Listing.Params<typeof unsorted>>().toEqualTypeOf<{
			'filter[title]'?: string;
			'filter[title][contains]'?: string;
			cursor?: string;
			limit?: string;
			fields?: string;
		}>();
		expect(Object.keys((Listing.schema(unsorted) as any).properties)).not.toContain('sort');
	});

	it('is the static type of Listing.schema, whose keys match it', () => {
		const schema = Listing.schema(spec);
		expectTypeOf<Static<typeof schema>>().toEqualTypeOf<Listing.Params<typeof spec>>();
		const keys: (keyof Listing.Params<typeof spec>)[] = [
			'filter[status]',
			'filter[status][eq]',
			'filter[status][in]',
			'filter[status][ne]',
			'filter[views]',
			'filter[views][gte]',
			'filter[views][lte]',
			'filter[createdAt]',
			'filter[createdAt][gte]',
			'filter[createdAt][lt]',
			'filter[title]',
			'filter[title][contains]',
			'filter[archived]',
			'filter[archived][isNull]',
			'sort',
			'cursor',
			'limit',
			'fields'
		];
		expect(Object.keys(schema.properties).sort()).toEqual([...keys].sort());
	});

	it('is accepted by Listing.parse', () => {
		const query: Listing.Params<typeof spec> = { 'filter[status][in]': 'draft,published' };
		expect(Listing.parse(spec, query).filters).toEqual([
			{ field: 'status', column: 'status', operator: 'in', value: ['draft', 'published'] }
		]);
	});
});

describe('offset pagination', () => {
	const offsetSpec = Listing.define(Post, {
		filters: { status: ['eq'] },
		sort: ['createdAt'],
		defaultSort: '-createdAt',
		limit: { default: 10, max: 50 },
		pagination: 'offset'
	});

	it('reads the page, from 1 by default', () => {
		expect(Listing.parse(offsetSpec).page).toBe(1);
		const query = Listing.parse(offsetSpec, { page: '3', limit: '5' });
		expect(query.page).toBe(3);
		expect(query.limit).toBe(5);
		expect(query.after).toBeUndefined();
	});

	it('refuses a page that is not a whole number from 1', () => {
		const problem = problemOf(() => Listing.parse(offsetSpec, { page: '0' }));
		expect(problem.errors).toEqual([
			{ pointer: '/query/page', message: 'must be a whole number from 1', code: 'page' }
		]);
	});

	it('names page instead of cursor in the query string', () => {
		expectTypeOf<Listing.Params<typeof offsetSpec>>().toEqualTypeOf<{
			'filter[status]'?: string;
			'filter[status][eq]'?: string;
			sort?: string;
			page?: string;
			limit?: string;
			fields?: string;
		}>();
		const keys = Object.keys((Listing.schema(offsetSpec) as any).properties);
		expect(keys).toContain('page');
		expect(keys).not.toContain('cursor');
	});

	it('types the parsed query by the pagination of the spec', () => {
		expectTypeOf(Listing.parse(offsetSpec).page).toEqualTypeOf<number>();
		expectTypeOf(Listing.parse(spec).page).toEqualTypeOf<undefined>();
	});
});

describe('pages', () => {
	const Item = { type: 'object', properties: { id: { type: 'string' } } } as any;

	it('marks the pages they build, without a member of their own', () => {
		const cursor = Listing.page(Listing.parse(spec), [{ id: 1 }]);
		const offset = Listing.offsetPage(
			Listing.parse({ ...spec, pagination: 'offset' as const }),
			[{ id: 1 }],
			1
		);

		expect(Listing.isPage(cursor)).toBe(true);
		expect(Listing.isPage(offset)).toBe(true);
		expect(Listing.isPage({ data: [], nextCursor: null })).toBe(false);
		expect(Listing.paginationOf(cursor)).toBe('cursor');
		expect(Listing.paginationOf(offset)).toBe('offset');
		expect(Object.keys(offset)).toEqual(['data', 'page', 'limit', 'total']);
		expect(JSON.parse(JSON.stringify(cursor))).toEqual({ data: [{ id: 1 }], nextCursor: null });
	});

	it('maps the rows of a page and keeps it a page', () => {
		const page = Listing.page(Listing.parse(spec), [{ id: 1 }, { id: 2 }]);
		const mapped = Listing.mapPage(page, (row) => ({ ref: `p${row.id}` }));

		expect(mapped).toEqual({ data: [{ ref: 'p1' }, { ref: 'p2' }], nextCursor: null });
		expect(Listing.isPage(mapped)).toBe(true);
		expectTypeOf(mapped.nextCursor).toEqualTypeOf<string | null>();
	});

	it('filters the rows of a page and keeps it a page, with its cursor', () => {
		const page = Listing.page(Listing.parse(spec, { limit: '2' }), [
			{ id: 1 },
			{ id: 2 },
			{ id: 3 }
		]);
		const kept = Listing.filterPage(page, (row) => row.id !== 1);

		expect(kept.data).toEqual([{ id: 2 }]);
		expect(kept.nextCursor).toBe(page.nextCursor);
		expect(Listing.isPage(kept)).toBe(true);

		const typed = Listing.filterPage(
			{ data: [1, 'a'] as (number | string)[], nextCursor: null },
			(row): row is string => typeof row === 'string'
		);
		expectTypeOf(typed.data).toEqualTypeOf<string[]>();
	});

	it('tags the schemas of pages with their pagination, and gives the schema of a row', () => {
		const cursor = Listing.pageSchema(Item);
		const offset = Listing.offsetPageSchema(Item);

		expect(Listing.pageSchemaPagination(cursor)).toBe('cursor');
		expect(Listing.pageSchemaPagination(offset)).toBe('offset');
		expect(Listing.isPageSchema(Item)).toBe(false);
		expect(Listing.itemSchemaOf(offset)).toBe(Item);
		expect(Object.keys((offset as any).properties)).toEqual(['data', 'page', 'limit', 'total']);
	});
});
