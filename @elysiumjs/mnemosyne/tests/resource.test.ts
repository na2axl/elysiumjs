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

import type { ColumnMetadata, ModelClass } from '../src/interfaces';

import { Resource } from '@elysiumjs/core';
import { describe, expect, it } from 'bun:test';
import { t } from 'elysia';

import { createSchemaFromModel } from '../src/model';
import { ModelResource } from '../src/resource';

const columns: ColumnMetadata[] = [
	{ name: 'id', dataType: 'uuid', nullable: false, hasDefault: true, isPrimaryKey: true },
	{ name: 'email', dataType: 'string', nullable: false, hasDefault: false, isPrimaryKey: false },
	{
		name: 'password_hash',
		dataType: 'string',
		nullable: false,
		hasDefault: false,
		isPrimaryKey: false
	},
	{
		name: 'created_at',
		dataType: 'datetime',
		nullable: false,
		hasDefault: true,
		isPrimaryKey: false
	},
	{ name: 'notes', dataType: 'string', nullable: true, hasDefault: false, isPrimaryKey: false }
];

const User = { selectSchema: createSchemaFromModel(columns) } as unknown as ModelClass<{
	id: string;
	email: string;
	password_hash: string;
	created_at: Date;
	notes: string | null;
}>;

const row = {
	id: '0b1f2c3d-0000-4000-8000-000000000000',
	email: 'ada@example.com',
	password_hash: 'x',
	created_at: new Date('2026-01-02T03:04:05.000Z'),
	notes: null
};

describe('ModelResource', () => {
	it('exposes the select schema with hidden columns dropped from responses and the schema', () => {
		const resource = ModelResource(User, { hidden: ['password_hash'] });

		expect(Resource.serialize(resource, { ...row, extra: 1 })).toEqual({
			id: row.id,
			email: 'ada@example.com',
			created_at: '2026-01-02T03:04:05.000Z',
			notes: null
		});
		expect(Object.keys((Resource.project(resource) as any).properties)).toEqual([
			'id',
			'email',
			'created_at',
			'notes'
		]);
	});

	it('picks, omits and extends columns', () => {
		const picked = ModelResource(User, { pick: ['id', 'email'] });
		expect(Object.keys((picked as any).properties)).toEqual(['id', 'email']);

		const extended = ModelResource(User, {
			omit: ['password_hash', 'notes'],
			extend: { avatarUrl: t.String() }
		});
		expect(Resource.serialize(extended, { ...row, avatarUrl: 'https://cdn/a.png' })).toEqual({
			id: row.id,
			email: 'ada@example.com',
			created_at: '2026-01-02T03:04:05.000Z',
			avatarUrl: 'https://cdn/a.png'
		});
	});
});
