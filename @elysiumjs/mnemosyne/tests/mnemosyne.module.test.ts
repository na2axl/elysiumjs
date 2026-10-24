// Copyright (c) 2026-present Workbud Technologies Inc. All rights reserved.
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

import type { TestingApp } from '@elysiumjs/core';

import { Application, RedisModule, Service, ServiceNotFoundError } from '@elysiumjs/core';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

import * as pkg from '../src';
import { Cache, MnemosyneModule } from '../src';
import { AbstractDatabase } from '../src/database';
import { getTenancyConfig, getTenancyStrategy } from '../src/tenancy';

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

class TestDatabase extends AbstractDatabase<any, any> {
	protected driver = {
		createConnection: mock(),
		withTransaction: mock(),
		getRawClient: mock()
	} as any;
}

describe('MnemosyneModule', () => {
	let app: TestingApp | undefined;

	beforeEach(() => {
		store.clear();
		ClientMock.mockClear();
	});

	afterEach(async () => {
		await app?.shutdown();
		app = undefined;
	});

	it('registers nothing on import', () => {
		expect(Service.exists('mnemosyne.cache.redis')).toBe(false);
		expect(Service.exists('mnemosyne.cache.memory')).toBe(false);
		expect(() => Cache.redis).toThrow(ServiceNotFoundError);
		expect(() => Cache.memory).toThrow(ServiceNotFoundError);
	});

	it('exports the module', () => {
		expect(pkg.MnemosyneModule).toBe(MnemosyneModule);
	});

	it('serves Cache.redis without opening a client until first use', async () => {
		app = await Application.testing({ modules: [redis, MnemosyneModule] });
		await app.get('mnemosyne.cache.redis');
		const cache = Cache.redis;
		expect(cache).toBeDefined();
		expect(ClientMock).not.toHaveBeenCalled();

		await cache.set('a', 'b');
		expect(ClientMock).toHaveBeenCalledTimes(1);
		expect(await cache.get('a')).toBe('b');
	});

	it('resolves the redis client through the async path on a lazy boot', async () => {
		app = await Application.testing({ modules: [redis, MnemosyneModule], boot: 'lazy' });
		await app.get('mnemosyne.cache.redis');
		expect(await Cache.redis.get('missing')).toBeUndefined();
	});

	it('uses the configured redis connection', async () => {
		app = await Application.testing({
			modules: [
				RedisModule.with({
					default: 'other',
					connections: { other: { url: 'redis://other:6379' } }
				}),
				MnemosyneModule.with({ cache: { redis: { connection: 'other' } } })
			]
		});
		await app.get('mnemosyne.cache.redis');
		await Cache.redis.set('a', 'b');
		expect(ClientMock).toHaveBeenCalledWith('redis://other:6379', {});
	});

	it('Cache.memory uses the configured TTL', async () => {
		app = await Application.testing({
			modules: [MnemosyneModule.with({ cache: { memory: { ttl: 40, lruSize: 10 } } })]
		});
		await app.get('mnemosyne.cache.memory');
		await Cache.memory.set('k', 'v');
		expect(await Cache.memory.get('k')).toBe('v');

		await Bun.sleep(80);
		expect(await Cache.memory.get('k')).toBeUndefined();
	});

	it('merges the defaults into a partial config', async () => {
		app = await Application.testing({
			modules: [MnemosyneModule.with({ cache: { memory: { ttl: 1000, lruSize: 10 } } })]
		});
		await app.get('mnemosyne.cache.memory');
		expect(Service.exists('mnemosyne.cache.memory')).toBe(true);
		expect(Service.exists('mnemosyne.cache.redis')).toBe(true);
	});

	describe('tenancy', () => {
		it('falls back to schema mode when no config is registered', async () => {
			app = await Application.testing({ modules: [MnemosyneModule] });
			expect(getTenancyConfig()).toEqual({ mode: 'schema' });
			expect(getTenancyStrategy()).toBeNull();
		});

		it('reads the registered tenancy config', async () => {
			app = await Application.testing({
				modules: [MnemosyneModule],
				overrides: { 'mnemosyne.tenancy.config': { mode: 'rls' } }
			});
			expect(getTenancyConfig()).toEqual({ mode: 'rls' });
		});

		it('reads the registered tenancy strategy', async () => {
			const strategy = { name: 'test' };
			app = await Application.testing({
				modules: [MnemosyneModule],
				overrides: { 'mnemosyne.tenancy.strategy': strategy }
			});
			expect(getTenancyStrategy()).toBe(strategy as any);
		});
	});

	describe('AbstractDatabase', () => {
		it('throws ServiceNotFoundError for a missing connection', async () => {
			app = await Application.testing({ modules: [MnemosyneModule] });
			expect(() => new TestDatabase().getConnection('missing')).toThrow(ServiceNotFoundError);
		});

		it('returns a registered connection', async () => {
			const connection = { id: 1 };
			app = await Application.testing({
				modules: [MnemosyneModule],
				overrides: { 'db.connection.main': connection }
			});
			const db = new TestDatabase();
			expect(db.connectionExists('main')).toBe(true);
			expect(db.getConnection('main')).toBe(connection);
		});
	});
});
