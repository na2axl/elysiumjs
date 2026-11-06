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

import { afterEach, describe, expect, it } from 'bun:test';

import { Application } from '../src/app';
import { Http } from '../src/http';
import { createHttpClient, UnexpectedStatusError } from '../src/http-client';
import { Module } from '../src/module';
import { Service } from '../src/service';
import { createTestingHttpApp } from '../src/testing';

class Greeter {
	public greet(name: string) {
		return `Hello ${name}`;
	}
}

@Http.controller({ path: '/echo' })
class EchoController {
	@Http.get()
	public show(@Http.context() c: any) {
		return { query: c.query, header: c.request.headers.get('x-test') };
	}

	@Http.post()
	public create(@Http.context() c: any) {
		c.set.status = 201;
		return { body: c.body, type: c.request.headers.get('content-type') };
	}

	@Http.get({ path: '/greet/:name' })
	public greet(@Http.param('name') name: string, @Service.inject(Greeter) greeter: Greeter) {
		return greeter.greet(name);
	}
}

@Module.register({ services: [Greeter], controllers: [EchoController] })
class EchoModule extends Module {}

@Application.register({ modules: [EchoModule], openapi: false })
class EchoApp extends Application {}

describe('HTTP test client', () => {
	let testing: Awaited<ReturnType<typeof createTestingHttpApp>> | undefined;

	afterEach(async () => {
		await testing?.shutdown();
		testing = undefined;
	});

	it('sends query strings and headers', async () => {
		testing = await createTestingHttpApp({ app: EchoApp });
		const response = await testing.http
			.get('/echo')
			.query({ page: 2, tag: 'a' })
			.header('x-test', 'yes')
			.send();

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ query: { page: '2', tag: 'a' }, header: 'yes' });
	});

	it('sends a JSON body with its content type, and can be awaited without send()', async () => {
		testing = await createTestingHttpApp({ app: EchoApp });
		const response = await testing.http.post('/echo').json({ name: 'Ada' });

		expect(response.status).toBe(201);
		expect(await response.json()).toEqual({ body: { name: 'Ada' }, type: 'application/json' });
	});

	it('applies overrides before the application boots', async () => {
		testing = await createTestingHttpApp({
			app: EchoApp,
			overrides: new Map([[Greeter, { greet: (name: string) => `Fake ${name}` }]])
		});

		const response = await testing.http.get('/echo/greet/Ada');
		expect(await response.text()).toBe('Fake Ada');
	});

	it('resolves services after booting the modules', async () => {
		testing = await createTestingHttpApp({ app: EchoApp });
		const greeter = await testing.get(Greeter, EchoModule);
		expect(greeter.greet('Ada')).toBe('Hello Ada');
	});

	it('throws with the body when the status is not the expected one', async () => {
		testing = await createTestingHttpApp({ app: EchoApp });
		const response = await testing.http.get('/missing');

		const error = await response.expectStatus(200).catch((e) => e);
		expect(error).toBeInstanceOf(UnexpectedStatusError);
		expect(error.actual).toBe(404);
		expect(error.message).toContain('Expected status 200, got 404');
		// The body is still readable after the check.
		expect(await response.text()).toBe(error.body);
	});

	it('does not share state between two testing apps', async () => {
		testing = await createTestingHttpApp({
			app: EchoApp,
			overrides: new Map([[Greeter, { greet: () => 'first' }]])
		});
		await testing.shutdown();

		testing = await createTestingHttpApp({ app: EchoApp });
		expect(await (await testing.http.get('/echo/greet/Ada')).text()).toBe('Hello Ada');
	});

	it('wraps any request handler', async () => {
		const seen: string[] = [];
		const client = createHttpClient(async (request) => {
			seen.push(`${request.method} ${request.url}`);
			return new Response('ok');
		}, 'https://api.test');

		await client
			.delete('/items/1')
			.query({ tag: ['a', 'b'] })
			.form({ a: '1' });
		await client.send(new Request('https://other.test/raw'));
		expect(seen).toEqual([
			'DELETE https://api.test/items/1?tag=a&tag=b',
			'GET https://other.test/raw'
		]);
	});
});
