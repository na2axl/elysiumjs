// Copyright (c) 2025-present Workbud Technologies Inc. All rights reserved.
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

import type { ColumnMetadata, ModelClass } from '../src/interfaces';

import { DomainError } from '@elysiumjs/core';
import { describe, expect, it } from 'bun:test';

import { createSchemaFromModel } from '../src/model';
import { Query } from '../src/query';

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

const spec = Query.define(Post, {
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

describe('Query.parse', () => {
	it('reads filters with their default or named operator, typed by the model', () => {
		const query = Query.parse(spec, {
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
		const query = Query.parse(spec, { 'filter[status][in]': 'draft, published' });
		expect(query.filters[0]).toMatchObject({ operator: 'in', value: ['draft', 'published'] });
	});

	it('sorts by the default sort and ends with the row key as tiebreaker', () => {
		expect(Query.parse(spec).sort).toEqual([
			{ field: 'createdAt', column: 'createdAt', direction: 'desc' },
			{ field: 'id', column: 'id', direction: 'desc' }
		]);
		expect(Query.parse(spec, { sort: 'title,-createdAt' }).sort).toEqual([
			{ field: 'title', column: 'title', direction: 'asc' },
			{ field: 'createdAt', column: 'createdAt', direction: 'desc' },
			{ field: 'id', column: 'id', direction: 'desc' }
		]);
	});

	it('bounds the page size', () => {
		expect(Query.parse(spec).limit).toBe(10);
		expect(Query.parse(spec, { limit: '50' }).limit).toBe(50);
	});

	it('reports every invalid parameter in one 400 problem', () => {
		const problem = problemOf(() =>
			Query.parse(spec, {
				'filter[secret]': 'x',
				'filter[status][gt]': 'a',
				'filter[views][gte]': 'many',
				sort: 'views',
				limit: '500',
				cursor: 'nope'
			})
		);

		expect(problem.status).toBe(400);
		expect(problem.extensions.errors).toEqual([
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
		const first = Query.parse(spec, { limit: '2' });
		const rows = [
			{ id: 3, createdAt: new Date('2026-03-01T00:00:00.000Z') },
			{ id: 2, createdAt: new Date('2026-02-01T00:00:00.000Z') },
			{ id: 1, createdAt: new Date('2026-01-01T00:00:00.000Z') }
		];
		const page = Query.page(first, rows);

		expect(page.data).toEqual(rows.slice(0, 2));
		expect(page.nextCursor).not.toBeNull();
		expect(Query.parse(spec, { cursor: page.nextCursor! }).after).toEqual([
			new Date('2026-02-01T00:00:00.000Z'),
			2
		]);
	});

	it('has no next cursor on the last page', () => {
		expect(Query.page(Query.parse(spec), [{ id: 1, createdAt: new Date() }]).nextCursor).toBeNull();
	});

	it('refuses a cursor from a listing with other sort keys', () => {
		const cursor = Query.cursorAfter(Query.parse(spec, { sort: 'title,createdAt' }), {
			id: 1,
			title: 'a',
			createdAt: new Date()
		});
		expect(problemOf(() => Query.parse(spec, { cursor })).status).toBe(400);
	});

	it('refuses a cursor whose values do not read as their sort keys', () => {
		const crafted = (values: unknown[]) =>
			Buffer.from(JSON.stringify(values)).toString('base64url');
		for (const values of [
			['not a date', 2],
			[{ $gt: 1 }, 2],
			['2026-01-01T00:00:00.000Z', 'x']
		]) {
			expect(problemOf(() => Query.parse(spec, { cursor: crafted(values) })).status).toBe(400);
		}
	});
});

describe('Query.schema', () => {
	it('documents the flat filter keys and the paging parameters', () => {
		const keys = Object.keys((Query.schema(spec) as any).properties);
		expect(keys).toContain('filter[status]');
		expect(keys).toContain('filter[status][in]');
		expect(keys).toContain('filter[archived][isNull]');
		expect(keys).toEqual(expect.arrayContaining(['sort', 'cursor', 'limit', 'fields']));
	});
});
