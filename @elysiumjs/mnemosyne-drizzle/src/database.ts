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

import { ElysiumError } from '@elysiumjs/core';
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
 * Thrown in RLS mode when work for one tenant would join a transaction bound to another.
 *
 * A transaction is bound to the tenant set when it is opened, for its whole life. Work for another
 * tenant must run outside the transaction, or in its own `withRLS()` before the transaction opens.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class TenantMismatchError extends ElysiumError {
	/**
	 * @param transactionTenant The tenant the open transaction is bound to, or `null` if none.
	 * @param tenant The tenant of the work that tried to join it.
	 */
	constructor(
		public readonly transactionTenant: string | null,
		public readonly tenant: string
	) {
		super(
			`Cannot run work for tenant "${tenant}" in a transaction bound to ` +
				(transactionTenant === null ? 'no tenant' : `tenant "${transactionTenant}"`) +
				'. Run it outside the transaction, or in its own withRLS() before opening the transaction.'
		);
	}
}

/** The tenant each open transaction is bound to, set by {@link bindTransactionTenant}. */
const transactionTenants = new WeakMap<object, string>();

/**
 * Binds a transaction to a tenant: sets the RLS tenant variable for the rest of the transaction.
 * @internal
 * @author Axel Nana <axel.nana@workbud.com>
 * @param tx The transaction, just opened.
 * @param tenant The tenant identifier.
 */
export const bindTransactionTenant = async (
	tx: DrizzleConnection,
	tenant: string
): Promise<void> => {
	const varName = getTenancyConfig().rls?.sessionVariable ?? 'app.current_tenant';
	await tx.execute(sql`SELECT set_config(${varName}, ${tenant}, true)`);
	transactionTenants.set(tx, tenant);
};

/**
 * Checks that work for a tenant may join an open transaction: it must be bound to that tenant.
 * @internal
 * @author Axel Nana <axel.nana@workbud.com>
 * @param tx The open transaction.
 * @param tenant The tenant of the work.
 * @throws {TenantMismatchError} If the transaction is bound to another tenant, or to none.
 */
export const assertTransactionTenant = (tx: DrizzleConnection, tenant: string): void => {
	const bound = transactionTenants.get(tx);
	if (bound !== tenant) throw new TenantMismatchError(bound ?? null, tenant);
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
	 * Runs a callback in a transaction, joining the one open on the connection if any.
	 *
	 * In RLS mode, a new transaction is bound to the current tenant (or `public`), and an open one
	 * is only joined when it is bound to the current tenant.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param callback The function to run with the transaction.
	 * @param name The connection name.
	 * @returns The return value of the callback.
	 * @throws {TenantMismatchError} If the open transaction is bound to another tenant.
	 */
	public override async transaction<T>(
		callback: (tx: DrizzleConnection) => Promise<T>,
		name: string = 'default'
	): Promise<T> {
		if (getTenancyConfig().mode === 'rls') {
			const active = this.getActiveTransaction(this.getBaseConnection(name));
			if (active !== undefined) assertTransactionTenant(active, getCurrentTenant() ?? 'public');
		}
		return super.transaction(callback, name);
	}

	/**
	 * Creates a Drizzle connection from its properties. Used by the `DrizzleModule` to build
	 * the `db.connection.{name}` services.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param props The connection properties.
	 * @param name The name of the connection, which scopes its query cache.
	 * @returns A new connection.
	 */
	public createConnection(
		props: DrizzleConnectionProps,
		name: string = 'default'
	): DrizzleConnection {
		return this.driver.createConnection(props, name);
	}

	protected driver: DatabaseDriver<DrizzleConnection, DrizzleConnectionProps> = {
		createConnection(config, name: string = 'default') {
			const cache =
				config.cache === undefined
					? undefined
					: config.cache === true
						? new DrizzleDatabaseCache(undefined, undefined, undefined, name)
						: config.cache.enabled !== false
							? new DrizzleDatabaseCache(
									config.cache.strategy,
									config.cache.ttl,
									config.cache.storage,
									name,
									config.cache.prefix
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
					await bindTransactionTenant(
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
