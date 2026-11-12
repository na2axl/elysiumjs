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

import type { TestingApp } from '@elysiumjs/olympus';

import { Application } from '@elysiumjs/olympus';
import { Cache, cacheStoreService, MnemosyneModule } from '@elysiumjs/olympus/mnemosyne';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

import { KeyvRedis, RedisModule } from '../../src/index';

const store = new Map<string, string>();
const originalRedisClient = Bun.RedisClient;
const ClientMock = mock(function (_url: string, _options?: object) {
	return {
		close: mock(),
		get: mock(async (k: string) => store.get(k) ?? null),
		set: mock(async (k: string, v: string) => {
			store.set(k, v);
			return 'OK';
		})
	};
});
beforeAll(() => {
	Bun.RedisClient = ClientMock as unknown as typeof Bun.RedisClient;
});

afterAll(() => {
	Bun.RedisClient = originalRedisClient;
});

const redis = RedisModule.with({
	default: 'cache',
	connections: { cache: { url: 'redis://cache:6379' } }
});

const mnemosyne = (connection = 'cache') =>
	MnemosyneModule.with({ cache: { stores: { redis: () => new KeyvRedis({ connection }) } } });

describe('KeyvRedis as a mnemosyne cache store', () => {
	let app: TestingApp | undefined;

	beforeEach(() => {
		store.clear();
		ClientMock.mockClear();
	});

	afterEach(async () => {
		await app?.shutdown();
		app = undefined;
	});

	it('serves a KeyvRedis cache without opening a client until first use', async () => {
		app = await Application.testing({ modules: [redis, mnemosyne()] });
		await app.get(cacheStoreService('redis'));
		const cache = Cache.store('redis');
		expect(cache).toBeDefined();
		expect(ClientMock).not.toHaveBeenCalled();

		await cache.set('a', 'b');
		expect(ClientMock).toHaveBeenCalledTimes(1);
		expect(await cache.get('a')).toBe('b');
	});

	it('resolves the redis client through the async path on a lazy boot', async () => {
		app = await Application.testing({ modules: [redis, mnemosyne()], boot: 'lazy' });
		await app.get(cacheStoreService('redis'));
		expect(await Cache.store('redis').get('missing')).toBeUndefined();
	});

	it('uses the configured redis connection', async () => {
		app = await Application.testing({
			modules: [
				RedisModule.with({
					default: 'other',
					connections: { other: { url: 'redis://other:6379' } }
				}),
				mnemosyne('other')
			]
		});
		await app.get(cacheStoreService('redis'));
		await Cache.store('redis').set('a', 'b');
		expect(ClientMock).toHaveBeenCalledWith('redis://other:6379', {});
	});

	it('disconnect leaves the shared redis client open', async () => {
		app = await Application.testing({ modules: [redis, mnemosyne()] });
		await app.get('redis.connection.cache');
		const client = ClientMock.mock.results[0]!.value as { close: ReturnType<typeof mock> };
		const adapter = new KeyvRedis({ connection: 'cache' });

		await adapter.set('a', 'b');
		await adapter.disconnect();

		expect(client.close).not.toHaveBeenCalled();
		expect(ClientMock).toHaveBeenCalledTimes(1);
		expect(await adapter.get('a')).toBe('b');
	});
});
