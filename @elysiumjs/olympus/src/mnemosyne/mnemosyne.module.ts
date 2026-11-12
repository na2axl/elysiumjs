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

import type { ServiceFactoryDefinition } from '../index';
import type { KeyvStoreAdapter } from 'keyv';

import { Module } from '../index';
import { KeyvCacheableMemory } from 'cacheable';

import {
	cacheStoreService,
	makeCacheInterface,
	MEMORY_CACHE_SERVICE,
	REDIS_CACHE_SERVICE
} from './cache';
import { DbSeedCommand } from './commands/db_seed.command';
import { KeyvRedis } from './keyv-redis';

/**
 * Configuration of the {@link MnemosyneModule}.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type MnemosyneModuleConfig = {
	cache: {
		/** The Redis-backed cache. Set to `false` to not provide `Cache.redis`. */
		redis?:
			| {
					/** The name of the Redis connection to use. */
					connection: string;
			  }
			| false;

		/** The memory cache. Set to `false` to not provide `Cache.memory`. */
		memory?:
			| {
					/** The default TTL of entries, in milliseconds. */
					ttl: number;

					/** The maximum number of entries kept. */
					lruSize: number;
			  }
			| false;

		/**
		 * Other caches, each over the Keyv stores its function creates, read with
		 * `Cache.store(name)`. The function is called once per cache namespace.
		 */
		stores?: Record<string, () => KeyvStoreAdapter>;
	};
};

/**
 * Provides the caches as the global services `mnemosyne.cache.redis`,
 * `mnemosyne.cache.memory` and `mnemosyne.cache.store.<name>`, and the `db:seed` command. Tenancy
 * config and strategy, and database connections, are registered by the database driver modules.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
@Module.register<MnemosyneModuleConfig>({
	commands: [DbSeedCommand],
	services: (config) => {
		const services: ServiceFactoryDefinition[] = [];
		const { redis, memory, stores } = config.cache;

		if (redis) {
			services.push({
				name: REDIS_CACHE_SERVICE,
				global: true,
				factory: () => makeCacheInterface(() => new KeyvRedis({ connection: redis.connection }))
			});
		}

		if (memory) {
			services.push({
				name: MEMORY_CACHE_SERVICE,
				global: true,
				factory: () =>
					makeCacheInterface(
						() => new KeyvCacheableMemory({ ttl: memory.ttl, lruSize: memory.lruSize })
					)
			});
		}

		for (const [name, createStore] of Object.entries(stores ?? {})) {
			services.push({
				name: cacheStoreService(name),
				global: true,
				factory: () => makeCacheInterface(createStore)
			});
		}

		return services;
	}
})
export class MnemosyneModule extends Module.configurable<MnemosyneModuleConfig>({
	defaults: { cache: { redis: { connection: 'cache' }, memory: { ttl: 60000, lruSize: 5000 } } }
}) {}
