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

import type { Mock } from 'bun:test';

import { afterAll, beforeAll, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import { createCache } from 'cache-manager';
import { KeyvCacheableMemory } from 'cacheable';
import * as KV from 'keyv';

import { Application } from '../../src/index';
import { Cache, cacheStoreService, MnemosyneModule } from '../../src/mnemosyne';

// Mock dependencies
mock.module('cache-manager', () => ({
	createCache: mock(createCache)
}));

let app: Awaited<ReturnType<typeof Application.testing>>;

beforeAll(async () => {
	app = await Application.testing({
		modules: [
			MnemosyneModule.with({
				cache: {
					memory: { ttl: 60_000, lruSize: 5000 },
					stores: { shared: () => new KeyvCacheableMemory({ ttl: 60_000, lruSize: 5000 }) }
				}
			})
		]
	});
	await app.get(cacheStoreService('shared'));
	await app.get('mnemosyne.cache.memory');
});

afterAll(async () => {
	// Some tests spy on Keyv without restoring it
	mock.restore();
	await app.shutdown();
});

// Test the weak cache
describe('Cache.weak', () => {
	it('should get data from the weak cache', () => {
		// Create a test object to use as a context
		const testContext = {};

		// Get data from the cache (should initialize with empty object)
		const data = Cache.weak.get(testContext);

		// Check if the data is an empty object
		expect(data).toEqual({});

		// Verify that the context is now in the map
		expect(Cache.weak.map.has(testContext)).toBe(true);
	});

	it('should return existing data from the weak cache', () => {
		// Create a test object to use as a context
		const testContext = {};

		// Set some data in the cache
		const testData = { test: 'data' };
		Cache.weak.map.set(testContext, testData);

		// Get data from the cache
		const data = Cache.weak.get(testContext);

		// Check if the data matches what we set
		expect(data).toBe(testData);
	});

	it('should delete data from the weak cache', () => {
		// Create a test object to use as a context
		const testContext = {};

		// Set some data in the cache
		Cache.weak.map.set(testContext, { test: 'data' });

		// Verify that the context is in the map
		expect(Cache.weak.map.has(testContext)).toBe(true);

		// Delete the data
		Cache.weak.del(testContext);

		// Verify that the context is no longer in the map
		expect(Cache.weak.map.has(testContext)).toBe(false);
	});
});

// Test a cache over a named store
describe('Cache.store()', () => {
	beforeAll(async () => {
		await Cache.store('shared').clear();
	});

	// Reset mocks before each test
	beforeEach(() => {
		mock.restore();
	});

	it('should be created with the correct configuration', async () => {
		// Check if createCache was called with the correct parameters
		expect(createCache).toHaveBeenCalledWith({
			stores: expect.arrayContaining([expect.any(Object)])
		});
	});

	it('should call get method with the correct parameters', async () => {
		const getSpy = spyOn(Cache.store('shared'), 'get');

		// Call the get method
		const result = await Cache.store('shared').get('test-key');

		// Check if the get method was called with the correct parameters
		expect(getSpy).toHaveBeenCalledWith('test-key');

		// Check if the result is correct
		expect(result).toBeUndefined();
	});

	it('should call set method with the correct parameters', async () => {
		const setSpy = spyOn(Cache.store('shared'), 'set');

		// Call the set method
		const result = await Cache.store('shared').set('test-key', 'test-value', 3600);

		// Check if the set method was called with the correct parameters
		expect(setSpy).toHaveBeenCalledWith('test-key', 'test-value', 3600);

		// Check if the result is correct
		expect(result).toBe('test-value');
	});

	it('should call ttl method with the correct parameters', async () => {
		const ttlSpy = spyOn(Cache.store('shared'), 'ttl');

		// Call the ttl method
		const result = await Cache.store('shared').ttl('test-key');

		// Check if the ttl method was called with the correct parameters
		expect(ttlSpy).toHaveBeenCalledWith('test-key');

		const date = new Date(result!);

		// Check if the result is correct
		expect(date.getTime()).toBeGreaterThanOrEqual(Date.now() - 3600 * 1000);
	});

	it('should call del method with the correct parameters', async () => {
		const delSpy = spyOn(Cache.store('shared'), 'del');

		// Call the del method
		const result = await Cache.store('shared').del('test-key');

		// Check if the del method was called with the correct parameters
		expect(delSpy).toHaveBeenCalledWith('test-key');

		// Check if the result is correct
		expect(result).toBe(true);
	});

	it('should call mset method with the correct parameters', async () => {
		const msetSpy = spyOn(Cache.store('shared'), 'mset');

		// Set up the mock to return the test data
		const testData = [
			{ key: 'key1', value: 'value1', ttl: 3600 },
			{ key: 'key2', value: 'value2' }
		];

		// Call the mset method
		const result = await Cache.store('shared').mset(testData);

		// Check if the mset method was called with the correct parameters
		expect(msetSpy).toHaveBeenCalledWith(testData);

		// Check if the result is correct
		expect(result).toEqual(testData);
	});

	it('should call mget method with the correct parameters', async () => {
		const mgetSpy = spyOn(Cache.store('shared'), 'mget');

		// Call the mget method
		const result = await Cache.store('shared').mget(['key1', 'key2']);

		// Check if the mget method was called with the correct parameters
		expect(mgetSpy).toHaveBeenCalledWith(['key1', 'key2']);

		// Check if the result is correct
		expect(result).toEqual(['value1', 'value2']);
	});

	it('should call mdel method with the correct parameters', async () => {
		const mdelSpy = spyOn(Cache.store('shared'), 'mdel');

		// Call the mdel method
		const result = await Cache.store('shared').mdel(['key1', 'key2']);

		// Check if the mdel method was called with the correct parameters
		expect(mdelSpy).toHaveBeenCalledWith(['key1', 'key2']);

		// Check if the result is correct
		expect(result).toBe(true);
	});

	it('should call clear method', async () => {
		const clearSpy = spyOn(Cache.store('shared'), 'clear');

		// Call the clear method
		const result = await Cache.store('shared').clear();

		// Check if the clear method was called
		expect(clearSpy).toHaveBeenCalled();

		// Check if the result is correct
		expect(result).toBe(true);
	});

	it('should create a tagged cache with the correct namespace', () => {
		const keyvSpy = spyOn(KV, 'Keyv').mockReturnThis();

		// Call the tags method
		Cache.store('shared').tags('tag1', 'tag2');

		// Check if Keyv was instantiated with the correct namespace
		expect(keyvSpy).toHaveBeenCalledWith({
			store: expect.any(Object),
			namespace: 'cache__tag1__tag2',
			serialize: expect.any(Function),
			deserialize: expect.any(Function)
		});

		// Check if createCache was called
		expect(createCache).toHaveBeenCalled();
	});
});

// Test the memory cache
describe('Cache.memory', () => {
	// Reset mocks before each test
	beforeEach(() => {
		mock.restore();
	});

	it('should be created with the correct configuration', () => {
		// Check if createCache was called with the correct parameters
		expect(createCache).toHaveBeenCalledWith({
			stores: expect.arrayContaining([expect.any(Object)])
		});
	});

	it('should call set method with the correct parameters', async () => {
		const setSpy = spyOn(Cache.memory, 'set');

		// Call the set method
		const result = await Cache.memory.set('test-key', 'test-value', 3600);

		// Check if the set method was called with the correct parameters
		expect(setSpy).toHaveBeenCalledWith('test-key', 'test-value', 3600);

		// Check if the result is correct
		expect(result).toBe('test-value');
	});
	it('should call get method with the correct parameters', async () => {
		const getSpy = spyOn(Cache.memory, 'get');

		// Call the get method
		const result = await Cache.memory.get('test-key');

		// Check if the get method was called with the correct parameters
		expect(getSpy).toHaveBeenCalledWith('test-key');

		// Check if the result is correct
		expect(result).toBe('test-value');
	});

	it('should call ttl method with the correct parameters', async () => {
		const ttlSpy = spyOn(Cache.memory, 'ttl');

		// Call the ttl method
		const result = await Cache.memory.ttl('test-key');

		// Check if the ttl method was called with the correct parameters
		expect(ttlSpy).toHaveBeenCalledWith('test-key');

		const date = new Date(result!);

		// Check if the result is correct
		expect(date.getTime()).toBeGreaterThanOrEqual(Date.now() - 3600 * 1000);
	});

	it('should call del method with the correct parameters', async () => {
		const delSpy = spyOn(Cache.memory, 'del');

		// Call the del method
		const result = await Cache.memory.del('test-key');

		// Check if the del method was called with the correct parameters
		expect(delSpy).toHaveBeenCalledWith('test-key');

		// Check if the result is correct
		expect(result).toBe(true);
	});

	it('should call mset method with the correct parameters', async () => {
		const msetSpy = spyOn(Cache.memory, 'mset');

		// Set up the mock to return the test data
		const testData = [
			{ key: 'key1', value: 'value1', ttl: 3600 },
			{ key: 'key2', value: 'value2' }
		];

		// Call the mset method
		const result = await Cache.memory.mset(testData);

		// Check if the mset method was called with the correct parameters
		expect(msetSpy).toHaveBeenCalledWith(testData);

		// Check if the result is correct
		expect(result).toEqual(testData);
	});

	it('should call mget method with the correct parameters', async () => {
		const mgetSpy = spyOn(Cache.memory, 'mget');

		// Call the mget method
		const result = await Cache.memory.mget(['key1', 'key2']);

		// Check if the mget method was called with the correct parameters
		expect(mgetSpy).toHaveBeenCalledWith(['key1', 'key2']);

		// Check if the result is correct
		expect(result).toEqual(['value1', 'value2']);
	});

	it('should call mdel method with the correct parameters', async () => {
		const mdelSpy = spyOn(Cache.memory, 'mdel');

		// Call the mdel method
		const result = await Cache.memory.mdel(['key1', 'key2']);

		// Check if the mdel method was called with the correct parameters
		expect(mdelSpy).toHaveBeenCalledWith(['key1', 'key2']);

		// Check if the result is correct
		expect(result).toBe(true);
	});

	it('should call clear method', async () => {
		const clearSpy = spyOn(Cache.memory, 'clear');

		// Call the clear method
		const result = await Cache.memory.clear();

		// Check if the clear method was called
		expect(clearSpy).toHaveBeenCalled();

		// Check if the result is correct
		expect(result).toBe(true);
	});

	it('should create a tagged cache with the correct namespace', () => {
		const keyvSpy = spyOn(KV, 'Keyv').mockReturnThis();

		// Call the tags method
		Cache.memory.tags('tag1', 'tag2');

		// Check if Keyv was instantiated with the correct namespace
		expect(keyvSpy).toHaveBeenCalledWith({
			store: expect.any(Object),
			namespace: 'cache__tag1__tag2',
			serialize: expect.any(Function),
			deserialize: expect.any(Function)
		});

		// Check if createCache was called
		expect(createCache).toHaveBeenCalled();
	});
});

// Test cache with different TTL values
describe('Cache with TTL', () => {
	beforeEach(() => {
		mock.restore();
	});

	it('should set cache with TTL', async () => {
		const setSpy = spyOn(Cache.memory, 'set');

		// Call the set method with TTL
		await Cache.memory.set('test-key', 'test-value', 3600);

		// Check if the set method was called with the correct TTL
		expect(setSpy).toHaveBeenCalledWith('test-key', 'test-value', 3600);
	});

	it('should set cache without TTL', async () => {
		const setSpy = spyOn(Cache.memory, 'set');

		// Call the set method without TTL
		await Cache.memory.set('test-key', 'test-value');

		// Check if the set method was called without TTL
		expect(setSpy).toHaveBeenCalledWith('test-key', 'test-value');
	});

	it('should set multiple cache entries with different TTLs', async () => {
		const msetSpy = spyOn(Cache.memory, 'mset');

		// Set up the mock to return the test data
		const testData = [
			{ key: 'key1', value: 'value1', ttl: 3600 },
			{ key: 'key2', value: 'value2' }
		];

		// Call the mset method
		await Cache.memory.mset(testData);

		// Check if the mset method was called with the correct parameters
		expect(msetSpy).toHaveBeenCalledWith(testData);
	});
});

// Test cache namespacing and tagging
describe('Cache namespacing and tagging', () => {
	beforeEach(() => {
		mock.restore();
	});

	it('should create a tagged cache with a single tag', () => {
		const keyvSpy = spyOn(KV, 'Keyv').mockReturnThis();

		// Call the tags method with a single tag
		Cache.memory.tags('tag1');

		// Check if Keyv was instantiated with the correct namespace
		expect(keyvSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				namespace: 'cache__tag1'
			})
		);

		// Check if createCache was called
		expect(createCache).toHaveBeenCalled();
	});

	it('should create a tagged cache with multiple tags', () => {
		const keyvSpy = spyOn(KV, 'Keyv').mockReturnThis();

		// Call the tags method with multiple tags
		Cache.memory.tags('tag1', 'tag2', 'tag3');

		// Check if Keyv was instantiated with the correct namespace
		expect(keyvSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				namespace: 'cache__tag1__tag2__tag3'
			})
		);

		// Check if createCache was called
		expect(createCache).toHaveBeenCalled();

		keyvSpy.mockClear();
		(createCache as Mock<typeof createCache>).mockClear();

		// Call the tags method with multiple tags
		Cache.memory.tags('tag3', 'tag2', 'tag1');

		expect(keyvSpy).not.toHaveBeenCalled();
		expect(createCache).not.toHaveBeenCalled();
	});
});

describe('Cache namespace isolation', () => {
	const caches = { memory: () => Cache.memory, shared: () => Cache.store('shared') };
	for (const name of ['memory', 'shared'] as const) {
		describe(`Cache ${name}`, () => {
			beforeEach(() => {
				mock.restore();
			});

			it('keeps base and tagged entries apart', async () => {
				const base = caches[name]();
				const tagged = base.tags(`isolation-${name}`);

				await base.set('shared-key', 'base');
				await tagged.set('shared-key', 'tagged');

				expect(await base.get<string>('shared-key')).toBe('base');
				expect(await tagged.get<string>('shared-key')).toBe('tagged');
			});

			it('still reads base entries written before a tagged cache was created', async () => {
				const base = caches[name]();
				await base.set('before-tags', 'base');

				base.tags(`late-${name}`);

				expect(await base.get<string>('before-tags')).toBe('base');
			});

			it('clears only its own namespace', async () => {
				const base = caches[name]();
				const first = base.tags(`clear-a-${name}`);
				const second = base.tags(`clear-b-${name}`);

				await base.set('kept', 'base');
				await first.set('kept', 'first');
				await second.set('kept', 'second');

				await first.clear();

				expect(await first.get('kept')).toBeUndefined();
				expect(await base.get<string>('kept')).toBe('base');
				expect(await second.get<string>('kept')).toBe('second');

				await base.clear();

				expect(await base.get('kept')).toBeUndefined();
				expect(await second.get<string>('kept')).toBe('second');
			});

			it('deletes only its own keys', async () => {
				const base = caches[name]();
				const tagged = base.tags(`del-${name}`);

				await base.set('deleted', 'base');
				await tagged.set('deleted', 'tagged');
				await tagged.del('deleted');

				expect(await tagged.get('deleted')).toBeUndefined();
				expect(await base.get<string>('deleted')).toBe('base');
			});
		});
	}
});
