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

import type { Context } from '../src/http';
import type { TestingHttpApp } from '../src/testing';

import { afterEach, describe, expect, it } from 'bun:test';
import { t } from 'elysia';

import { Application } from '../src/app';
import { Http } from '../src/http';
import { Module } from '../src/module';
import { createTestingHttpApp } from '../src/testing';

@Http.controller('/hooks')
class HooksController {
	@Http.post('/raw', { parse: 'none' })
	public async raw(@Http.context() ctx: Context) {
		return { raw: await ctx.request.text() };
	}

	@Http.post('/text', { parse: 'text' })
	public text(@Http.body(t.String()) body: string) {
		return { body };
	}

	@Http.post('/parsed')
	public parsed(@Http.body(t.Object({ a: t.Number() })) body: { a: number }) {
		return body;
	}
}

@Module.register({ controllers: [HooksController] })
class HooksModule extends Module {}

@Application.register({ modules: [HooksModule], openapi: false })
class HooksApp extends Application {}

describe('the parse option of routes', () => {
	let testing: TestingHttpApp | undefined;

	afterEach(async () => {
		await testing?.shutdown();
		testing = undefined;
	});

	const start = async () => {
		testing = await createTestingHttpApp({ app: HooksApp });
		return testing.http;
	};

	it('leaves the body unread with none, so the handler reads the exact bytes', async () => {
		const http = await start();
		const raw = '{ "a" : 1 }';
		const response = await http
			.post('/hooks/raw')
			.header('content-type', 'application/json')
			.body(raw);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ raw });
	});

	it('parses with the parser it names, whatever the content type', async () => {
		const http = await start();
		const response = await http
			.post('/hooks/text')
			.header('content-type', 'application/json')
			.body('{"a":1}');

		expect(await response.json()).toEqual({ body: '{"a":1}' });
	});

	it('follows the content type by default', async () => {
		const http = await start();
		expect(await (await http.post('/hooks/parsed').json({ a: 1 })).json()).toEqual({ a: 1 });
	});

	it('refuses @Http.body() on a route that does not parse its body', async () => {
		@Http.controller('/broken')
		class BrokenController {
			@Http.post('/', { parse: 'none' })
			public handle(@Http.body(t.String()) body: string) {
				return body;
			}
		}
		@Module.register({ controllers: [BrokenController] })
		class BrokenModule extends Module {}
		@Application.register({ modules: [BrokenModule], openapi: false })
		class BrokenApp extends Application {}

		await expect(createTestingHttpApp({ app: BrokenApp })).rejects.toThrow(
			/BrokenController.handle: a route that does not parse its body cannot take @Http.body\(\)/
		);
	});
});
