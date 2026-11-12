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

import { afterEach, beforeAll, describe, expect, it } from 'bun:test';

import { Application, Http, Module, Runtime } from '../../src/index';
import { CacheInterceptor, MnemosyneModule } from '../../src/mnemosyne';

let calls = 0;

@Http.controller('/c')
class CachedController {
	@Http.get('/trending', { interceptors: [CacheInterceptor.with({ ttl: 60_000 })] })
	public trending() {
		return { calls: ++calls };
	}

	@Http.get('/short', { interceptors: [CacheInterceptor.with({ ttl: 30 })] })
	public short() {
		return { calls: ++calls };
	}

	@Http.post('/trending', { interceptors: [CacheInterceptor.with({ ttl: 60_000 })] })
	public create() {
		return { calls: ++calls };
	}
}

@Module.register({ controllers: [CachedController] })
class CachedModule extends Module {}

@Application.register({
	modules: [MnemosyneModule, CachedModule],
	openapi: false
})
class CachedApp extends Application {}

describe('CacheInterceptor', () => {
	beforeAll(() => {
		Runtime.use({
			name: 'test',
			env: () => ({ NODE_ENV: 'test' }),
			sleep: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
			serve: () => {},
			exit: () => {},
			argv: () => [],
			write: () => {},
			terminal: () => undefined,
			onShutdown: () => () => {}
		});
	});

	let testing: { shutdown(): Promise<void>; http: any } | undefined;

	afterEach(async () => {
		await testing?.shutdown();
		testing = undefined;
		calls = 0;
	});

	it('serves a cached result without calling the handler again', async () => {
		testing = await Application.testing({ app: CachedApp });
		const first = await testing.http.get('/c/trending');
		const second = await testing.http.get('/c/trending');

		expect(await first.json()).toEqual({ calls: 1 });
		expect(first.headers.get('x-cache')).toBe('miss');
		expect(await second.json()).toEqual({ calls: 1 });
		expect(second.headers.get('x-cache')).toBe('hit');
	});

	it('keys entries by query string and tenant', async () => {
		testing = await Application.testing({ app: CachedApp });
		await testing.http.get('/c/trending').query({ page: 1 });
		const other = await testing.http.get('/c/trending').query({ page: 2 });
		const tenant = await testing.http
			.get('/c/trending')
			.query({ page: 1 })
			.header('x-tenant-id', 'acme');

		expect(await other.json()).toEqual({ calls: 2 });
		expect(await tenant.json()).toEqual({ calls: 3 });
	});

	it('expires entries after the TTL', async () => {
		testing = await Application.testing({ app: CachedApp });
		await testing.http.get('/c/short');
		await new Promise((resolve) => setTimeout(resolve, 60));
		const later = await testing.http.get('/c/short');

		expect(await later.json()).toEqual({ calls: 2 });
	});

	it('never caches other methods', async () => {
		testing = await Application.testing({ app: CachedApp });
		await testing.http.post('/c/trending');
		const second = await testing.http.post('/c/trending');

		expect(await second.json()).toEqual({ calls: 2 });
		expect(second.headers.get('x-cache')).toBeNull();
	});
});
