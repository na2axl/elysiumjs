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

import type { KeyvStoreAdapter } from 'keyv';

import { Service, ServiceNotFoundError } from '@elysiumjs/core';
import { createCache } from 'cache-manager';
import { Keyv } from 'keyv';
import { alphabetical } from 'radash';

/** Name of the global service backing `Cache.redis`. */
export const REDIS_CACHE_SERVICE = 'mnemosyne.cache.redis';

/** Name of the global service backing `Cache.memory`. */
export const MEMORY_CACHE_SERVICE = 'mnemosyne.cache.memory';

/**
 * Interface for a cache storage.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export interface CacheInterface {
	/**
	 * Retrieves the cached data for a given key.
	 * @typeParam T The type of the cached data.
	 *
	 * @param key The key of the cached data.
	 */
	get<T>(key: string): Promise<T | undefined>;

	/**
	 * Retrieves the cached data for a given list of keys.
	 * @typeParam T The type of the cached data.
	 *
	 * @param keys The list of cached data keys.
	 */
	mget<T>(keys: string[]): Promise<Array<T | undefined>>;

	/**
	 * Gets the TTL of the cached data with the given key.
	 * @param key The key of the cached data.
	 * @returns The TTL of the cached data, or `undefined` if the data does not exist.
	 */
	ttl(key: string): Promise<number | undefined>;

	/**
	 * Caches data under the given key and an optional TTL.
	 * @typeParam T The type of the data to cache.
	 *
	 * @param key The key of the cached data.
	 * @param data The data to cache.
	 * @param ttl The optional TTL of the cached data. If not defined, the data is cached forever.
	 * @returns The cached data.
	 */
	set<T>(key: string, data: T, ttl?: number): Promise<T>;

	/**
	 * Caches data under the given list of keys and an optional TTL.
	 * @typeParam T The type of the data to cache.
	 *
	 * @param data The list of data to cache.
	 * @returns The list of cached data.
	 */
	mset<T>(
		data: Array<{
			key: string;
			value: T;
			ttl?: number;
		}>
	): Promise<
		Array<{
			key: string;
			value: T;
			ttl?: number;
		}>
	>;

	/**
	 * Deletes the cached data with the given key.
	 * @typeParam T The type of the data to cache.
	 *
	 * @param key The key of the cached data.
	 * @returns `true` if the data was deleted, `false` otherwise.
	 */
	del(key: string): Promise<boolean>;

	/**
	 * Deletes the cached data with the given list of keys.
	 * @typeParam T The type of the data to cache.
	 *
	 * @param keys The list of cached data keys.
	 * @returns `true` if the data was deleted, `false` otherwise.
	 */
	mdel(keys: string[]): Promise<boolean>;

	/**
	 * Deletes all cached data.
	 * @returns `true` if the data was deleted, `false` otherwise.
	 */
	clear(): Promise<boolean>;

	/**
	 * Creates a sub-cache with the given tags.
	 * @param tags The list of tags for the sub-cache.
	 */
	tags(...tags: string[]): Omit<CacheInterface, 'tags'>;
}

/**
 * Makes a cache interface over stores built by the given factory.
 *
 * Keyv writes its namespace on the store adapter it wraps, so adapters cannot be shared between
 * namespaces: the last namespace would win for every Keyv using the adapter, and `clear()` would
 * wipe the other namespaces. The base cache and each tagged cache therefore get their own adapter.
 * @author Axel Nana <axel.nana@workbud.com>
 * @param createStore Creates a new store adapter, called once per namespace.
 * @returns A new `CacheInterface`.
 */
export const makeCacheInterface = (createStore: () => KeyvStoreAdapter): CacheInterface => {
	const makeNamespace = (namespace: string) =>
		createCache({
			stores: [new Keyv({ store: createStore(), namespace })]
		}) as Omit<CacheInterface, 'tags'>;

	const base = makeNamespace('cache');
	const tagsCache = new Map<string, Omit<CacheInterface, 'tags'>>();

	return {
		...base,
		tags(...tags) {
			const namespace = `cache__${alphabetical(tags, (item) => item).join('__')}`;
			let cache = tagsCache.get(namespace);

			if (!cache) {
				cache = makeNamespace(namespace);
				tagsCache.set(namespace, cache);
			}

			return cache;
		}
	};
};

const getCache = (name: string): CacheInterface => {
	const cache = Service.get<CacheInterface>(name);
	if (!cache) throw new ServiceNotFoundError(name);
	return cache;
};

/**
 * Static access to the caches provided by the `MnemosyneModule`.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export abstract class Cache {
	/**
	 * A weak cache storage for simple non-intrusive caching of data.
	 * @author Axel Nana <axel.nana@workbud.com>
	 */
	public static readonly weak = Object.seal({
		/**
		 * INTERNAL USAGE ONLY.
		 * @private
		 */
		map: new WeakMap<object, unknown>(),

		/**
		 * Gets the cached data for a given context.
		 * @param ctx The cache context.
		 * @returns The cached data.
		 */
		get<T extends object>(ctx: object): T {
			if (!this.map.has(ctx)) this.map.set(ctx, {});
			return this.map.get(ctx) as T;
		},

		/**
		 * Deletes the cached data for a given context.
		 * @param ctx The cache context.
		 */
		del(ctx: object): void {
			this.map.delete(ctx);
		}
	});

	/**
	 * Redis-based cache storage.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @throws {ServiceNotFoundError} If the `MnemosyneModule` is not loaded or has no redis cache.
	 */
	public static get redis(): CacheInterface {
		return getCache(REDIS_CACHE_SERVICE);
	}

	/**
	 * Memory-based cache storage.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @throws {ServiceNotFoundError} If the `MnemosyneModule` is not loaded or has no memory cache.
	 */
	public static get memory(): CacheInterface {
		return getCache(MEMORY_CACHE_SERVICE);
	}
}
