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

import type { TestingApp } from '../../src/index';

import { afterEach, describe, expect, it, mock } from 'bun:test';
import { KeyvCacheableMemory } from 'cacheable';

import { Application, Service, ServiceNotFoundError } from '../../src/index';
import * as pkg from '../../src/mnemosyne';
import { Cache, cacheStoreService, MnemosyneModule } from '../../src/mnemosyne';
import { AbstractDatabase } from '../../src/mnemosyne/database';
import { getTenancyConfig, getTenancyStrategy } from '../../src/mnemosyne/tenancy';

class TestDatabase extends AbstractDatabase<any, any> {
	protected driver = {
		createConnection: mock(),
		withTransaction: mock(),
		getRawClient: mock()
	} as any;
}

describe('MnemosyneModule', () => {
	let app: TestingApp | undefined;

	afterEach(async () => {
		await app?.shutdown();
		app = undefined;
	});

	it('registers nothing on import', () => {
		expect(Service.exists('mnemosyne.cache.memory')).toBe(false);
		expect(() => Cache.memory).toThrow(ServiceNotFoundError);
	});

	it('exports the module', () => {
		expect(pkg.MnemosyneModule).toBe(MnemosyneModule);
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

	it('provides a cache over each configured store', async () => {
		app = await Application.testing({
			modules: [
				MnemosyneModule.with({
					cache: {
						stores: { local: () => new KeyvCacheableMemory({ ttl: 1000, lruSize: 10 }) }
					}
				})
			]
		});
		await app.get(cacheStoreService('local'));
		await Cache.store('local').set('k', 'v');
		expect(await Cache.store('local').get('k')).toBe('v');
		expect(await Cache.store('local').tags('a').get('k')).toBeUndefined();
		expect(() => Cache.store('missing')).toThrow(ServiceNotFoundError);
	});

	it('merges the defaults into a partial config', async () => {
		app = await Application.testing({
			modules: [MnemosyneModule.with({ cache: { memory: { ttl: 1000, lruSize: 10 } } })]
		});
		await app.get('mnemosyne.cache.memory');
		expect(Service.exists('mnemosyne.cache.memory')).toBe(true);
	});

	it('provides no Redis cache of its own', async () => {
		app = await Application.testing({ modules: [MnemosyneModule] });
		await app.get('mnemosyne.cache.memory');
		expect(Service.exists('mnemosyne.cache.redis')).toBe(false);
		expect(() => Cache.store('redis')).toThrow(ServiceNotFoundError);
	});

	it('registers no memory cache when it is set to false', async () => {
		app = await Application.testing({
			modules: [MnemosyneModule.with({ cache: { memory: false } })]
		});

		expect(Service.exists('mnemosyne.cache.memory')).toBe(false);
		expect(() => Cache.memory).toThrow(ServiceNotFoundError);
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
