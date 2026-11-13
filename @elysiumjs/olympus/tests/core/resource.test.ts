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

import { afterEach, describe, expect, it } from 'bun:test';
import { t } from 'elysia';

import { Application } from '../../src/app';
import { Http } from '../../src/http';
import { Module } from '../../src/module';
import { DomainError } from '../../src/problem';
import { Resource, toJsonForm } from '../../src/resource';
import { createTestingHttpApp } from '../../src/testing';

const dateTime = () =>
	t
		.Codec(t.String({ format: 'date-time' }))
		.Decode((value: string) => new Date(value))
		.Encode((value: Date) => value.toISOString());

const UserResource = t.Object({
	id: t.String(),
	name: t.String(),
	birthday: t.Optional(t.String({ format: 'date' })),
	createdAt: dateTime(),
	passwordHash: Resource.hidden(t.String()),
	team: t.Nullable(t.Object({ id: t.String() }))
});

const created = new Date('2026-01-02T03:04:05.000Z');

const row = {
	id: 'u1',
	name: 'Ada',
	birthday: new Date('1990-12-10T00:00:00.000Z'),
	createdAt: created,
	passwordHash: 'secret',
	internal: true,
	team: { id: 't1', budget: 10 }
};

describe('Resource.serialize', () => {
	it('strips undeclared and hidden fields and turns dates into ISO strings', () => {
		expect(Resource.serialize(UserResource, row)).toEqual({
			id: 'u1',
			name: 'Ada',
			birthday: '1990-12-10',
			createdAt: '2026-01-02T03:04:05.000Z',
			team: { id: 't1' }
		});
	});

	it('uses toJSON() of objects such as luxon DateTimes', () => {
		const dateTimeLike = { toJSON: () => '2026-01-02T03:04:05.000+01:00' };
		const value = Object.assign(Object.create({ toJSON: dateTimeLike.toJSON }), {});
		expect(Resource.serialize(t.Object({ at: t.String() }), { at: value, other: 1 })).toEqual({
			at: '2026-01-02T03:04:05.000+01:00'
		});
	});

	it('serializes an object through the union branch it belongs to', () => {
		const SignIn = t.Union([
			t.Object({ accessToken: t.String(), refreshToken: t.String(), expiresAt: t.String() }),
			t.Object({ expiresAt: t.String() }),
			t.Object({ secondFactor: t.Object({ methods: t.Array(t.String()) }) })
		]);
		expect(
			Resource.serialize(SignIn, { secondFactor: { methods: ['totp'] }, internal: true })
		).toEqual({ secondFactor: { methods: ['totp'] } });
		expect(
			Resource.serialize(SignIn, { accessToken: 'a', refreshToken: 'r', expiresAt: 'e', x: 1 })
		).toEqual({ accessToken: 'a', refreshToken: 'r', expiresAt: 'e' });
		expect(Resource.serialize(SignIn, { expiresAt: 'e', x: 1 })).toEqual({ expiresAt: 'e' });
	});

	it('serializes a discriminated union through the branch of its literal', () => {
		const Method = t.Union([
			t.Object({ method: t.Literal('otp'), channel: t.String() }),
			t.Object({ method: t.Literal('totp'), secret: t.String(), uri: t.String() })
		]);
		expect(Resource.serialize(Method, { method: 'totp', secret: 's', uri: 'u' })).toEqual({
			method: 'totp',
			secret: 's',
			uri: 'u'
		});
		expect(Resource.serialize(Method, { method: 'otp', channel: 'sms', secret: 's' })).toEqual({
			method: 'otp',
			channel: 'sms'
		});
	});

	it('keeps null in nullable fields and serializes arrays item by item', () => {
		expect(Resource.serialize(t.Array(UserResource), [{ ...row, team: null }])).toEqual([
			{
				id: 'u1',
				name: 'Ada',
				birthday: '1990-12-10',
				createdAt: '2026-01-02T03:04:05.000Z',
				team: null
			}
		]);
	});

	it('applies a sparse fieldset to an object, array items and data items', () => {
		expect(Resource.serialize(UserResource, row, { fields: ['id', 'name'] })).toEqual({
			id: 'u1',
			name: 'Ada'
		});
		expect(Resource.serialize(t.Array(UserResource), [row], { fields: ['id'] })).toEqual([
			{ id: 'u1' }
		]);
		const Page = t.Object({ data: t.Array(UserResource), nextCursor: t.Nullable(t.String()) });
		expect(
			Resource.serialize(Page, { data: [row], nextCursor: null }, { fields: ['name'] })
		).toEqual({ data: [{ name: 'Ada' }], nextCursor: null });
	});

	it('refuses fields the resource does not expose, hidden ones included', () => {
		try {
			Resource.serialize(UserResource, row, { fields: ['id', 'passwordHash', 'nope'] });
			throw new Error('expected a problem');
		} catch (error) {
			expect(error).toBeInstanceOf(DomainError);
			expect((error as DomainError).status).toBe(400);
			expect((error as DomainError).errors).toEqual([
				{ pointer: '/query/fields', message: 'unknown field "passwordHash"', code: 'fields' },
				{ pointer: '/query/fields', message: 'unknown field "nope"', code: 'fields' }
			]);
		}
	});

	it('projects the schema clients see: no hidden fields, no codecs', () => {
		const projected = Resource.project(UserResource) as any;
		expect(Object.keys(projected.properties)).toEqual([
			'id',
			'name',
			'birthday',
			'createdAt',
			'team'
		]);
		expect(projected.required).not.toContain('passwordHash');
		expect('~codec' in projected.properties.createdAt).toBe(false);
		expect(projected.properties.createdAt.format).toBe('date-time');
	});
});

@Http.controller('/users')
class UserController {
	@Http.get('/:id', { response: UserResource })
	public show() {
		return row;
	}

	@Http.get('/', { response: { 200: t.Array(UserResource) } })
	public list() {
		return [row, { ...row, id: 'u2', name: 'Grace' }];
	}

	@Http.get('/raw/:id', { response: t.Object({ id: t.String() }), serialize: false })
	public raw() {
		return { id: 'u1' };
	}
}

@Module.register({ controllers: [UserController] })
class UserModule extends Module {}

@Application.register({ modules: [UserModule], openapi: false })
class ResourceApp extends Application {}

@Application.register({ modules: [UserModule], openapi: {} })
class DocumentedApp extends Application {}

describe('serialized routes', () => {
	let testing: Awaited<ReturnType<typeof createTestingHttpApp>> | undefined;

	afterEach(async () => {
		await testing?.shutdown();
		testing = undefined;
	});

	const start = async () => {
		testing = await createTestingHttpApp({ app: ResourceApp });
		return testing.http;
	};

	it('serializes the handler result through the response schema', async () => {
		const http = await start();
		const response = await http.get('/users/u1');

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			id: 'u1',
			name: 'Ada',
			birthday: '1990-12-10',
			createdAt: '2026-01-02T03:04:05.000Z',
			team: { id: 't1' }
		});
	});

	it('selects fields with ?fields=, on each item of a list', async () => {
		const http = await start();
		const response = await http.get('/users').query({ fields: 'id,name' });

		expect(await response.json()).toEqual([
			{ id: 'u1', name: 'Ada' },
			{ id: 'u2', name: 'Grace' }
		]);
	});

	it('answers 400 problem details for an unknown field', async () => {
		const http = await start();
		const response = await http.get('/users/u1').query({ fields: 'passwordHash' });

		expect(response.status).toBe(400);
		expect(response.headers.get('content-type')).toBe('application/problem+json');
		expect((await response.json()).errors[0].pointer).toBe('/query/fields');
	});

	it('documents the projected schema, without hidden fields', async () => {
		testing = await createTestingHttpApp({ app: DocumentedApp });
		const spec = await (await testing.http.get('/openapi/json')).json();
		const text = JSON.stringify(spec.paths['/users/{id}']);

		expect(text).toContain('createdAt');
		expect(text).not.toContain('passwordHash');
	});

	it('leaves results alone when serialize is false', async () => {
		const http = await start();
		const response = await http.get('/users/raw/u1');

		expect(await response.json()).toEqual({ id: 'u1' });
	});
});

describe('toJsonForm', () => {
	class Point {
		constructor(
			public x: number,
			public y: number
		) {}

		public toJSON() {
			return { x: this.x, y: this.y, kind: 'point' };
		}
	}

	it('answers the JSON form of a class instance with toJSON()', () => {
		expect(toJsonForm(new Point(1, 2))).toEqual({ x: 1, y: 2, kind: 'point' });
	});

	it('answers plain objects and arrays as they are, which JSON.stringify writes in full', () => {
		const page = { data: [new Point(1, 2)], nextCursor: null };
		expect(toJsonForm(page)).toBe(page);
		expect(JSON.parse(JSON.stringify(toJsonForm(page)))).toEqual({
			data: [{ x: 1, y: 2, kind: 'point' }],
			nextCursor: null
		});
		const list = [new Point(3, 4)];
		expect(toJsonForm(list)).toBe(list);
	});
});
