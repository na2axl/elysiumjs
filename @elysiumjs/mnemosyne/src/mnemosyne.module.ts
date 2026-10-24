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

import type { ServiceFactoryDefinition } from '@elysiumjs/core';

import { Module } from '@elysiumjs/core';
import { KeyvCacheableMemory } from 'cacheable';

import { makeCacheInterface, MEMORY_CACHE_SERVICE, REDIS_CACHE_SERVICE } from './cache';
import { KeyvRedis } from './keyv-redis';

/**
 * Configuration of the {@link MnemosyneModule}.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type MnemosyneModuleConfig = {
	cache: {
		/** The Redis-backed cache. Omit to not provide `Cache.redis`. */
		redis?: {
			/** The name of the Redis connection to use. */
			connection: string;
		};

		/** The memory cache. Omit to not provide `Cache.memory`. */
		memory?: {
			/** The default TTL of entries, in milliseconds. */
			ttl: number;

			/** The maximum number of entries kept. */
			lruSize: number;
		};
	};
};

/**
 * Provides the caches as the global services `mnemosyne.cache.redis` and
 * `mnemosyne.cache.memory`. Tenancy config and strategy, and database connections, are
 * registered by the database driver modules.
 * @author Axel Nana <axel.nana@workbud.com>
 */
@Module.register<MnemosyneModuleConfig>({
	services: (config) => {
		const services: ServiceFactoryDefinition[] = [];
		const { redis, memory } = config.cache;

		if (redis) {
			services.push({
				name: REDIS_CACHE_SERVICE,
				global: true,
				factory: () => makeCacheInterface(new KeyvRedis({ connection: redis.connection }))
			});
		}

		if (memory) {
			services.push({
				name: MEMORY_CACHE_SERVICE,
				global: true,
				factory: () =>
					makeCacheInterface(new KeyvCacheableMemory({ ttl: memory.ttl, lruSize: memory.lruSize }))
			});
		}

		return services;
	}
})
export class MnemosyneModule extends Module.configurable<MnemosyneModuleConfig>({
	defaults: { cache: { redis: { connection: 'cache' }, memory: { ttl: 60000, lruSize: 5000 } } }
}) {}
