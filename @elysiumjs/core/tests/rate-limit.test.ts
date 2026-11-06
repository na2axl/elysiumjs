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

import type { RateLimitStore } from '../src/rate-limit';

import { afterEach, describe, expect, it } from 'bun:test';

import { Application } from '../src/app';
import { Http } from '../src/http';
import { Module } from '../src/module';
import { MemoryRateLimitStore, RateLimit } from '../src/rate-limit';
import { createTestingHttpApp } from '../src/testing';

describe('MemoryRateLimitStore', () => {
	it('counts hits per key in fixed windows', async () => {
		const store = new MemoryRateLimitStore();
		const first = await store.hit('a', 50);
		expect(first.count).toBe(1);
		expect((await store.hit('a', 50)).count).toBe(2);
		expect((await store.hit('b', 50)).count).toBe(1);

		await new Promise((resolve) => setTimeout(resolve, 60));
		expect((await store.hit('a', 50)).count).toBe(1);
	});
});

const keys: string[] = [];
const recording: RateLimitStore = {
	async hit(key, windowMs) {
		keys.push(key);
		return { count: keys.filter((k) => k === key).length, resetAt: Date.now() + windowMs };
	}
};

@Http.controller({ path: '/limited' })
@RateLimit({ window: 60_000, max: 2 })
class LimitedController {
	@Http.get({ path: '/a' })
	public a() {
		return { ok: true };
	}

	@Http.get({ path: '/b' })
	@RateLimit({ window: 60_000, max: 1, name: 'strict' })
	public b() {
		return { ok: true };
	}

	@Http.get({ path: '/free' })
	@RateLimit(false)
	public free() {
		return { ok: true };
	}

	@Http.get({ path: '/user' })
	@RateLimit({
		window: 60_000,
		max: 1,
		key: ({ request }) => request.headers.get('x-user') ?? 'anonymous'
	})
	public user() {
		return { ok: true };
	}
}

@Http.controller({ path: '/open' })
class OpenController {
	@Http.get({ path: '/' })
	public index() {
		return { ok: true };
	}
}

let allowed = 1;
const deciding: RateLimitStore = {
	async hit() {
		return { limited: allowed-- <= 0 };
	}
};

@Http.controller({ path: '/decided' })
class DecidedController {
	@Http.get({ path: '/' })
	@RateLimit({ window: 10_000, max: 1, store: deciding })
	public index() {
		return { ok: true };
	}
}

@Module.register({ controllers: [LimitedController, OpenController, DecidedController] })
class LimitedModule extends Module {}

@Application.register({ modules: [LimitedModule], openapi: false })
class LimitedApp extends Application {}

@Application.register({
	modules: [LimitedModule],
	openapi: false,
	rateLimit: { window: 60_000, max: 1, store: recording }
})
class GlobalLimitApp extends Application {}

describe('rate limits', () => {
	let testing: Awaited<ReturnType<typeof createTestingHttpApp>> | undefined;

	afterEach(async () => {
		await testing?.shutdown();
		testing = undefined;
		keys.length = 0;
	});

	it('sets the RateLimit headers and answers 429 problem details over the limit', async () => {
		testing = await createTestingHttpApp({ app: LimitedApp });
		const { http } = testing;

		const first = await http.get('/limited/a');
		expect(first.status).toBe(200);
		expect(first.headers.get('ratelimit-limit')).toBe('2');
		expect(first.headers.get('ratelimit-remaining')).toBe('1');
		expect(first.headers.get('ratelimit-policy')).toBe('2;w=60');
		expect(Number(first.headers.get('ratelimit-reset'))).toBeGreaterThan(0);

		expect((await http.get('/limited/a')).status).toBe(200);
		const over = await http.get('/limited/a');
		expect(over.status).toBe(429);
		expect(over.headers.get('content-type')).toBe('application/problem+json');
		expect(Number(over.headers.get('retry-after'))).toBeGreaterThan(0);
		expect(over.headers.get('ratelimit-remaining')).toBe('0');
		const problem = await over.json();
		expect(problem.status).toBe(429);
		expect(problem.retryAfter).toBeGreaterThan(0);
	});

	it('answers 429 with a whole window to wait when the store only decides', async () => {
		testing = await createTestingHttpApp({ app: LimitedApp });
		const { http } = testing;

		const first = await http.get('/decided');
		expect(first.status).toBe(200);
		expect(first.headers.get('ratelimit-limit')).toBe('1');
		expect(first.headers.get('ratelimit-policy')).toBe('1;w=10');
		expect(first.headers.get('ratelimit-reset')).toBeNull();

		const over = await http.get('/decided');
		expect(over.status).toBe(429);
		expect(over.headers.get('retry-after')).toBe('10');
		expect(over.headers.get('ratelimit-remaining')).toBe('0');
	});

	it('lets a route override or turn off the limit of its controller', async () => {
		testing = await createTestingHttpApp({ app: LimitedApp });
		const { http } = testing;

		expect((await http.get('/limited/b')).status).toBe(200);
		expect((await http.get('/limited/b')).status).toBe(429);
		for (let i = 0; i < 4; i++) {
			const response = await http.get('/limited/free');
			expect(response.status).toBe(200);
			expect(response.headers.get('ratelimit-limit')).toBeNull();
		}
	});

	it('counts by a custom key', async () => {
		testing = await createTestingHttpApp({ app: LimitedApp });
		const { http } = testing;

		expect((await http.get('/limited/user').header('x-user', 'ada')).status).toBe(200);
		expect((await http.get('/limited/user').header('x-user', 'grace')).status).toBe(200);
		expect((await http.get('/limited/user').header('x-user', 'ada')).status).toBe(429);
	});

	it('applies the app limit and store to routes that set none', async () => {
		testing = await createTestingHttpApp({ app: GlobalLimitApp });
		const { http } = testing;

		expect((await http.get('/open')).status).toBe(200);
		expect((await http.get('/open')).status).toBe(429);
		expect((await http.get('/limited/a')).status).toBe(200);
		expect(keys).toEqual([
			'rl:default:unknown:GET /open',
			'rl:default:unknown:GET /open',
			'rl:default:unknown:GET /limited/a'
		]);
	});
});
