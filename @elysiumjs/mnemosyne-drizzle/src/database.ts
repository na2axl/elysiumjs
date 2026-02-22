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

import type { DrizzleConfig } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql';
import type { CacheConfig } from 'drizzle-orm/cache/core/types';
import type { CacheInterface, DatabaseCacheConfig, DatabaseDriver } from '@elysiumjs/mnemosyne';

import { getTableName, is, Table } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sql';
import { Cache as DrizzleCache } from 'drizzle-orm/cache/core';
import { AbstractDatabase, createDatabaseCacheStorage } from '@elysiumjs/mnemosyne';

// ============================================================================
// Types
// ============================================================================

/**
 * Connection configuration for Drizzle ORM.
 *
 * Extends `DrizzleConfig` with connection details and optional caching.
 *
 * @author Axel Nana <axel.nana@workbud.com>
 * @template TSchema The Drizzle schema type.
 */
export type DrizzleConnectionProps<TSchema extends Record<string, unknown> = Record<string, never>> =
	Omit<DrizzleConfig<TSchema>, 'cache'> &
	(
		| { connection: string | ({ url?: string } & Bun.SQLOptions) }
		| { client: Bun.SQL }
	) & {
		cache?: true | DatabaseCacheConfig;
	};

/**
 * A Drizzle database connection backed by Bun's SQL driver.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type DrizzleConnection = BunSQLDatabase<Record<string, never>> & { $client: Bun.SQL };

// ============================================================================
// DrizzleDatabaseCache
// ============================================================================

/**
 * Drizzle query cache backed by the framework's cache storage.
 *
 * Extends the Drizzle `Cache` base class and implements the
 * framework's `DatabaseCacheStrategy` interface so that query
 * results can be transparently cached and invalidated.
 *
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class DrizzleDatabaseCache extends DrizzleCache {
	#cache: Omit<CacheInterface, 'tags'>;
	private usedTablesPerKey: Record<string, string[]> = {};

	constructor(
		private readonly cacheStrategy: 'explicit' | 'all' = 'explicit',
		private readonly globalTtl: number = 1,
		storageEngine: 'redis' | 'memory' = 'redis'
	) {
		super();
		this.#cache = createDatabaseCacheStorage({ storage: storageEngine });
	}

	public override strategy(): 'explicit' | 'all' {
		return this.cacheStrategy;
	}

	public override async get(key: string): Promise<any[] | undefined> {
		return (await this.#cache.get<any[]>(key)) ?? undefined;
	}

	public override async put(
		key: string,
		response: any,
		tables: string[],
		_isTag: boolean,
		config?: CacheConfig
	): Promise<void> {
		await this.#cache.set(key, response, (config?.ex ?? this.globalTtl) * 1000);
		for (const table of tables) {
			const keys = this.usedTablesPerKey[table];
			if (keys === undefined) {
				this.usedTablesPerKey[table] = [key];
			} else {
				keys.push(key);
			}
		}
	}

	public override async onMutate(params: {
		tags?: string | string[];
		tables?: string | string[] | Table<any> | Table<any>[];
	}): Promise<void> {
		const tagsArray = params.tags
			? (Array.isArray(params.tags) ? params.tags : [params.tags])
			: [];
		const tablesArray = params.tables
			? (Array.isArray(params.tables) ? params.tables : [params.tables])
			: [];
		const keysToDelete = new Set<string>();

		for (const table of tablesArray) {
			const tableName = is(table, Table) ? getTableName(table as Table) : (table as string);
			const keys = this.usedTablesPerKey[tableName] ?? [];
			for (const key of keys) keysToDelete.add(key);
		}

		if (keysToDelete.size > 0 || tagsArray.length > 0) {
			await this.#cache.mdel(tagsArray);
			await this.#cache.mdel([...keysToDelete]);
			for (const table of tablesArray) {
				const tableName = is(table, Table) ? getTableName(table as Table) : (table as string);
				this.usedTablesPerKey[tableName] = [];
			}
		}
	}
}

// ============================================================================
// DrizzleDatabase
// ============================================================================

/**
 * Drizzle-specific database manager.
 *
 * Implements the abstract database class with a driver that creates
 * Drizzle connections using Bun's built-in SQL client.
 *
 * @author Axel Nana <axel.nana@workbud.com>
 */
class DrizzleDatabase extends AbstractDatabase<DrizzleConnection, DrizzleConnectionProps> {
	protected driver: DatabaseDriver<DrizzleConnection, DrizzleConnectionProps> = {
		createConnection(config) {
			const cache = config.cache === undefined
				? undefined
				: config.cache === true
					? new DrizzleDatabaseCache()
					: config.cache.enabled !== false
						? new DrizzleDatabaseCache(config.cache.strategy, config.cache.ttl, config.cache.storage)
						: undefined;
			return drizzle({ ...config, cache }) as DrizzleConnection;
		},

		withTransaction(connection, callback) {
			return (connection as any).transaction((tx: any) => callback(tx));
		},

		getRawClient(connection) {
			return connection.$client;
		}
	};
}

/**
 * Singleton Drizzle database manager.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export const Database = new DrizzleDatabase();
