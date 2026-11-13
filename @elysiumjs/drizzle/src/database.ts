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

import type { DatabaseCacheConfig, DatabaseDriver } from '@elysiumjs/olympus/mnemosyne';
import type { AnyRelations, DrizzleConfig, EmptyRelations } from 'drizzle-orm';
import type { PgAsyncDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import type { DrizzleDriver } from './driver';

import { ElysiumError } from '@elysiumjs/olympus';
import { AbstractDatabase, getCurrentTenant, getTenancyConfig } from '@elysiumjs/olympus/mnemosyne';
import { sql } from 'drizzle-orm';

import { bunRequire } from './bun-require';
import { DrizzleDatabaseCache } from './cache';
import { MissingDriverError } from './driver';
import { templateClientMigrations } from './migration-clients';

export { DEFAULT_CACHE_TTL, DrizzleDatabaseCache } from './cache';

// ============================================================================
// Types
// ============================================================================

/**
 * Connection configuration for Drizzle ORM.
 *
 * Extends `DrizzleConfig` with the driver and optional caching. Without `driver`, `connection`
 * or `client` connect with Bun SQL, on Bun only.
 *
 * @author Axel Nana <ax.lnana@outlook.com>
 * @template TRelations The Drizzle relations of the connection, from `defineRelations()`.
 */
export type DrizzleConnectionProps<TRelations extends AnyRelations = EmptyRelations> = Omit<
	DrizzleConfig<TRelations>,
	'cache'
> &
	(
		| { driver: DrizzleDriver }
		| { connection: string | ({ url?: string } & Record<string, unknown>) }
		| { client: unknown }
	) & {
		cache?: true | DatabaseCacheConfig;
	};

/**
 * A Drizzle database connection, whatever its driver.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type DrizzleConnection = PgAsyncDatabase<DrizzleQueryResultHKT, any> & { $client: any };

/**
 * The query results of a {@link DrizzleConnection}: rows, for `returning()` and selects. What
 * `execute()` resolves to depends on the driver.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export interface DrizzleQueryResultHKT extends PgQueryResultHKT {
	type: this['row'][];
}

/** The connections already closed. */
const closedConnections = new WeakSet<object>();

/** The driver of each connection, to close it with. */
const connectionDrivers = new WeakMap<object, DrizzleDriver>();

/**
 * The Bun SQL driver used when a connection sets none. Loaded on first use, on Bun only, so that
 * other runtimes never load `bun`.
 */
const defaultDriver = (props: Record<string, unknown>, name: string): DrizzleDriver => {
	// portability-allow: the default driver is Bun SQL, loaded on Bun only
	if (typeof (globalThis as { Bun?: unknown }).Bun === 'undefined') {
		throw new MissingDriverError(name);
	}
	const { drizzle } = bunRequire()!('drizzle-orm/bun-sql');
	const client = 'client' in props ? { client: props.client } : { connection: props.connection };
	return {
		name: 'bun-sql',
		connect: (config) => drizzle({ ...config, ...client }),
		close: async (connection) => {
			await connection.$client.close();
		},
		migrations: (connection) => templateClientMigrations(connection.$client)
	};
};

/**
 * The driver of a connection.
 * @internal
 * @author Axel Nana <ax.lnana@outlook.com>
 * @param connection The connection.
 */
export const getConnectionDriver = (connection: DrizzleConnection): DrizzleDriver | undefined =>
	connectionDrivers.get(connection);

/**
 * Closes the client of a connection through its driver.
 * @internal
 * @author Axel Nana <ax.lnana@outlook.com>
 * @param connection The connection.
 */
export const closeConnection = async (connection: DrizzleConnection): Promise<void> => {
	const driver = connectionDrivers.get(connection);
	// Closed once: a command may close its connection before the module closes them all.
	if (!driver || closedConnections.has(connection)) return;
	closedConnections.add(connection);
	await driver.close(connection);
};

// ============================================================================
// Transaction Tenant
// ============================================================================

/**
 * Thrown in RLS mode when work for one tenant would join a transaction bound to another.
 *
 * A transaction is bound to the tenant set when it is opened, for its whole life. Work for another
 * tenant must run outside the transaction, or in its own `withRLS()` before the transaction opens.
 * @author Axel Nana <ax.lnana@outlook.com>
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
 * @author Axel Nana <ax.lnana@outlook.com>
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
 * @author Axel Nana <ax.lnana@outlook.com>
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
 * Drizzle connections through the {@link DrizzleDriver} of each connection.
 *
 * @author Axel Nana <ax.lnana@outlook.com>
 */
class DrizzleDatabase extends AbstractDatabase<DrizzleConnection, DrizzleConnectionProps> {
	/**
	 * Retrieves the connection with the given name, or the transaction open on it.
	 *
	 * In RLS mode, an open transaction bound to a tenant is only returned to work for that tenant,
	 * the current one (or `public`).
	 * @author Axel Nana <ax.lnana@outlook.com>
	 * @param name The connection name.
	 * @returns The connection, or its open transaction.
	 * @throws {TenantMismatchError} If the open transaction is bound to another tenant.
	 */
	public override getConnection(name: string = 'default'): DrizzleConnection {
		const connection = super.getConnection(name);
		if (transactionTenants.has(connection) && getTenancyConfig().mode === 'rls') {
			assertTransactionTenant(connection, getCurrentTenant() ?? 'public');
		}
		return connection;
	}

	/**
	 * Runs a callback in a transaction, joining the one open on the connection if any.
	 *
	 * In RLS mode, a new transaction is bound to the current tenant (or `public`), and an open one
	 * is only joined when it is bound to the current tenant.
	 * @author Axel Nana <ax.lnana@outlook.com>
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
	 * @author Axel Nana <ax.lnana@outlook.com>
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
			const {
				driver: chosen,
				connection: _url,
				client: _client,
				cache: _cache,
				...drizzleConfig
			} = config as typeof config & {
				driver?: DrizzleDriver;
				connection?: unknown;
				client?: unknown;
			};
			const driver = chosen ?? defaultDriver(config as Record<string, unknown>, name);
			const connection = driver.connect({ ...drizzleConfig, cache } as never);
			connectionDrivers.set(connection, driver);
			if (cache === undefined) return connection;

			// Transactions share the connection's cache: bypass it inside them, and invalidate
			// what they mutate once they commit. The method is looked up on each call, so that a
			// database resolved per invocation (Hyperdrive) runs it on the current one.
			const transaction: DrizzleConnection['transaction'] = (callback, txConfig) =>
				Object.getPrototypeOf(connection).transaction.call(connection, callback, txConfig);
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
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export const Database = new DrizzleDatabase();
