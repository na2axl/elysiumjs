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

import type { DatabaseCacheConfig, DatabaseDriver } from '@elysiumjs/mnemosyne';
import type { DrizzleConfig } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';

import { AbstractDatabase, getCurrentTenant, getTenancyConfig } from '@elysiumjs/mnemosyne';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sql';

import { DrizzleDatabaseCache } from './cache';

export { DEFAULT_CACHE_TTL, DrizzleDatabaseCache } from './cache';

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
export type DrizzleConnectionProps<
	TSchema extends Record<string, unknown> = Record<string, never>
> = Omit<DrizzleConfig<TSchema>, 'cache'> &
	({ connection: string | ({ url?: string } & Bun.SQLOptions) } | { client: Bun.SQL }) & {
		cache?: true | DatabaseCacheConfig;
	};

/**
 * A Drizzle database connection backed by Bun's SQL driver.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type DrizzleConnection = BunSQLDatabase<Record<string, never>> & { $client: Bun.SQL };

// ============================================================================
// Transaction Tenant
// ============================================================================

/**
 * The tenant set on each open transaction by {@link setTransactionTenant}.
 * @internal
 */
export const transactionTenants = new WeakMap<object, string>();

/**
 * Sets the RLS tenant variable on a transaction, for the rest of that transaction only.
 * @internal
 * @author Axel Nana <axel.nana@workbud.com>
 * @param tx The transaction.
 * @param tenant The tenant identifier.
 */
export const setTransactionTenant = async (
	tx: DrizzleConnection,
	tenant: string
): Promise<void> => {
	const varName = getTenancyConfig().rls?.sessionVariable ?? 'app.current_tenant';
	await tx.execute(sql`SELECT set_config(${varName}, ${tenant}, true)`);
	transactionTenants.set(tx, tenant);
};

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
	/**
	 * Creates a Drizzle connection from its properties. Used by the `DrizzleModule` to build
	 * the `db.connection.{name}` services.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param props The connection properties.
	 * @returns A new connection.
	 */
	public createConnection(props: DrizzleConnectionProps): DrizzleConnection {
		return this.driver.createConnection(props);
	}

	protected driver: DatabaseDriver<DrizzleConnection, DrizzleConnectionProps> = {
		createConnection(config) {
			const cache =
				config.cache === undefined
					? undefined
					: config.cache === true
						? new DrizzleDatabaseCache()
						: config.cache.enabled !== false
							? new DrizzleDatabaseCache(
									config.cache.strategy,
									config.cache.ttl,
									config.cache.storage
								)
							: undefined;
			const connection = drizzle({ ...config, cache }) as DrizzleConnection;
			if (cache === undefined) return connection;

			// Transactions share the connection's cache: bypass it inside them, and invalidate
			// what they mutate once they commit.
			const transaction = connection.transaction.bind(connection);
			return Object.assign(connection, {
				transaction: ((callback, txConfig) =>
					cache.trackTransaction(() => transaction(callback, txConfig))) as typeof transaction
			});
		},

		withTransaction(connection, callback) {
			return connection.transaction(async (tx) => {
				// In RLS mode, every transaction opened through the database (`Database.transaction`,
				// `@transactional` handlers) is scoped to the current tenant.
				if (getTenancyConfig().mode === 'rls') {
					await setTransactionTenant(
						tx as unknown as DrizzleConnection,
						getCurrentTenant() ?? 'public'
					);
				}
				return callback(tx as unknown as DrizzleConnection);
			});
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
