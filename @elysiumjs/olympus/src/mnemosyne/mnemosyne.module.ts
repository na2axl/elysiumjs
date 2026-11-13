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

import type { KeyvStoreAdapter } from 'keyv';
import type { ServiceFactoryDefinition } from '../index';
import type { RepositoryCacheOptions } from './repository-cache';

import { KeyvCacheableMemory } from 'cacheable';

import { Module } from '../index';
import { cacheStoreService, makeCacheInterface, MEMORY_CACHE_SERVICE } from './cache';
import { DbSeedCommand } from './commands/db_seed.command';
import { REPOSITORY_CACHE_SERVICE } from './repository-cache';

/**
 * Configuration of the {@link MnemosyneModule}.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type MnemosyneModuleConfig = {
	cache: {
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
		 * `Cache.store(name)`. The function is called once per cache namespace. For Redis,
		 * `@elysiumjs/redis` provides `KeyvRedis`: `{ redis: () => new KeyvRedis({ connection: 'cache' }) }`.
		 */
		stores?: Record<string, () => KeyvStoreAdapter>;
	};

	/** The defaults of the repositories. */
	repositories?: {
		/**
		 * The cache every repository reads through, unless its class sets `static cache` to
		 * `false`. A class's own `static cache` is merged over it.
		 * @example
		 * ```ts
		 * MnemosyneModule.with({
		 * 	cache: { stores: { redis: () => new KeyvRedis({ connection: 'cache' }) } },
		 * 	repositories: { cache: { store: 'redis', ttl: 300_000 } }
		 * });
		 * ```
		 */
		cache?: RepositoryCacheOptions;
	};
};

/**
 * Provides the caches as the global services `mnemosyne.cache.memory` and
 * `mnemosyne.cache.store.<name>`, and the `db:seed` command. Tenancy
 * config and strategy, and database connections, are registered by the database driver modules.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
@Module.register<MnemosyneModuleConfig>({
	commands: [DbSeedCommand],
	services: (config) => {
		const services: ServiceFactoryDefinition[] = [];
		const { memory, stores } = config.cache;

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

		if (config.repositories?.cache) {
			const defaults = config.repositories.cache;
			services.push({ name: REPOSITORY_CACHE_SERVICE, global: true, factory: () => defaults });
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
	defaults: { cache: { memory: { ttl: 60000, lruSize: 5000 } } }
}) {}
