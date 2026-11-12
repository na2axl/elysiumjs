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

import { Application } from '../src/app';
import { Http } from '../src/http';
import { Module } from '../src/module';
import { createTestingHttpApp } from '../src/testing';

@Http.controller('/users')
class UserController {
	@Http.post('/:id')
	public update(
		@Http.param('id') id: string,
		@Http.body(t.Object({ age: t.Number() })) body: { age: number },
		@Http.query(t.Object({ notify: t.Optional(t.String()), source: t.String() }))
		query: { notify?: string; source: string }
	) {
		return { id, age: body.age, source: query.source };
	}
}

@Http.controller('/tenants')
class TenantController {
	@Http.get('/', { headers: t.Object({ 'X-Source': t.Optional(t.String()) }) })
	public show(@Http.header('X-Tenant-Id') tenant: string) {
		return { tenant };
	}
}

@Module.register({ controllers: [UserController, TenantController] })
class UserModule extends Module {}

const appWith = (http: object) => {
	@Application.register({ modules: [UserModule], openapi: {}, http })
	class DocsApp extends Application {}
	return DocsApp;
};

describe('OpenAPI document', () => {
	let testing: Awaited<ReturnType<typeof createTestingHttpApp>> | undefined;

	afterEach(async () => {
		await testing?.shutdown();
		testing = undefined;
	});

	const operation = async (http: object = {}) => {
		testing = await createTestingHttpApp({ app: appWith(http) });
		const response = await testing.http.get('/openapi/json').send();
		return ((await response.json()) as any).paths['/users/{id}'].post;
	};

	it('documents the body of a route, with the body limit on', async () => {
		const op = await operation();

		expect(Object.keys(op.requestBody.content)).toContain('application/json');
		expect(op.requestBody.content['application/json'].schema.properties.age.type).toBe('number');
	});

	it('documents the query parameters of a route', async () => {
		const op = await operation();
		const query = op.parameters.filter((parameter: any) => parameter.in === 'query');

		expect(query).toEqual([
			{ name: 'notify', in: 'query', required: false, schema: { type: 'string' } },
			{ name: 'source', in: 'query', required: true, schema: { type: 'string' } }
		]);
	});
});

describe('Query validation', () => {
	it('refuses a query that does not match its schema with 422', async () => {
		const testing = await createTestingHttpApp({ app: appWith({}) });
		try {
			const missing = await testing.http.post('/users/1').json({ age: 3 }).send();
			expect(missing.status).toBe(422);

			const valid = await testing.http.post('/users/1?source=app').json({ age: 3 }).send();
			expect(valid.status).toBe(200);
			expect(await valid.json()).toEqual({ id: '1', age: 3, source: 'app' });
		} finally {
			await testing.shutdown();
		}
	});
});

describe('Request headers', () => {
	let testing: Awaited<ReturnType<typeof createTestingHttpApp>> | undefined;

	afterEach(async () => {
		await testing?.shutdown();
		testing = undefined;
	});

	it('documents the headers of the route option and of @Http.header()', async () => {
		testing = await createTestingHttpApp({ app: appWith({}) });
		const response = await testing.http.get('/openapi/json').send();
		const { paths } = (await response.json()) as any;
		const op = (paths['/tenants'] ?? paths['/tenants/']).get;

		expect(op.parameters).toEqual([
			{ name: 'x-source', in: 'header', required: false, schema: { type: 'string' } },
			{ name: 'x-tenant-id', in: 'header', required: true, schema: { type: 'string' } }
		]);
	});

	it('gives the handler the header, and refuses a missing one with 400', async () => {
		testing = await createTestingHttpApp({ app: appWith({}) });

		const ok = await testing.http.get('/tenants').header('x-tenant-id', 'acme').send();
		expect(ok.status).toBe(200);
		expect(await ok.json()).toEqual({ tenant: 'acme' });

		const missing = await testing.http.get('/tenants').send();
		expect(missing.status).toBe(400);
		const problem = (await missing.json()) as any;
		expect(problem.code).toBe('BAD_REQUEST');
		expect(problem.errors).toEqual([
			expect.objectContaining({ pointer: '/headers/x-tenant-id', message: 'is required' })
		]);
	});
});
