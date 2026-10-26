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

import type { CacheInterface } from './cache';
import type { DatabaseCacheConfig, DatabaseDriver } from './interfaces';

import { Application, Service, ServiceNotFoundError } from '@elysiumjs/core';

import { Cache } from './cache';

/**
 * Name of the global service running a callback in a database transaction, registered by driver
 * modules. Used by `@transactional` HTTP handlers; defined by `@elysiumjs/core`.
 */
export { DATABASE_TRANSACTION_SERVICE } from '@elysiumjs/core';

/**
 * Creates a cache storage instance tagged for database use.
 * Drivers can use this to build their cache backends.
 * @author Axel Nana <axel.nana@workbud.com>
 * @param config The database cache configuration.
 * @returns A cache interface tagged with 'database'.
 */
export const createDatabaseCacheStorage = (
	config: DatabaseCacheConfig
): Omit<CacheInterface, 'tags'> => {
	return Cache[config.storage ?? 'redis'].tags('database');
};

/**
 * Abstract database manager.
 *
 * Retrieves named database connections using a driver. Connections are registered as
 * global services `db.connection.{name}` by the driver modules.
 *
 * @author Axel Nana <axel.nana@workbud.com>
 * @template TConnection The connection type managed by the driver.
 * @template TConnectionConfig The configuration used to create a connection.
 */
export abstract class AbstractDatabase<TConnection, TConnectionConfig> {
	/**
	 * The database driver used to create and manage connections.
	 */
	protected abstract driver: DatabaseDriver<TConnection, TConnectionConfig>;

	/**
	 * Creates a service name for a database connection. Driver modules register their
	 * connections (and the `default` alias) under this name.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param name The name of the connection.
	 * @returns A service name for the connection.
	 */
	public static getConnectionName(name: string): string {
		return `db.connection.${name}`;
	}

	/**
	 * Retrieves the connection with the given name.
	 *
	 * When a transaction is open on that connection in the current async context (see
	 * {@link transaction}), the transaction handle is returned instead. Transactions are tracked by
	 * the connection they run on, so every name of a connection (such as `default` and the name it
	 * aliases) sees them.
	 * @throws {ServiceNotFoundError} If no connection with that name is registered.
	 *
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param name The connection name.
	 * @returns The connection with the given name, or its open transaction.
	 */
	public getConnection(name: string = 'default'): TConnection {
		if (name === 'default') {
			const legacy = Application.context.getStore()?.get('db:tx') as TConnection | undefined;
			if (legacy) return legacy;
		}

		const connection = this.getBaseConnection(name);
		return this.getActiveTransaction(connection) ?? connection;
	}

	/**
	 * Retrieves the connection with the given name, ignoring any open transaction.
	 * @throws {ServiceNotFoundError} If no connection with that name is registered.
	 *
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param name The connection name.
	 * @returns The connection registered under the given name.
	 */
	public getBaseConnection(name: string = 'default'): TConnection {
		const serviceName = AbstractDatabase.getConnectionName(name);
		const connection = Service.get<TConnection>(serviceName);
		if (connection === null) throw new ServiceNotFoundError(serviceName);

		return connection;
	}

	/**
	 * Checks whether a transaction is open on the given connection in the current async context.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param name The connection name.
	 * @returns `true` if a transaction is open on the connection, `false` otherwise.
	 */
	public inTransaction(name: string = 'default'): boolean {
		return this.getActiveTransaction(this.getBaseConnection(name)) !== undefined;
	}

	/**
	 * Runs a callback in a transaction on the given connection.
	 *
	 * The transaction is registered in the async context for the duration of the callback, so that
	 * {@link getConnection} (and the repositories using it) returns it for that connection. When a
	 * transaction is already open on the connection, the callback joins it.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @template T The return type of the callback.
	 * @param callback The function to run in the transaction. Receives the transaction handle.
	 * @param name The connection name.
	 * @returns The return value of the callback.
	 */
	public async transaction<T>(
		callback: (tx: TConnection) => Promise<T>,
		name: string = 'default'
	): Promise<T> {
		const connection = this.getBaseConnection(name);
		const active = this.getActiveTransaction(connection);
		if (active !== undefined) return callback(active);

		return this.driver.withTransaction(connection, (tx) =>
			this.runInTransaction(connection, tx, () => callback(tx))
		);
	}

	/**
	 * Runs a callback with a transaction registered in the async context for a connection.
	 *
	 * The current context store is copied, never modified. Drivers and tenancy strategies that open
	 * transactions themselves use it to make the transaction visible to {@link getConnection}.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @template T The return type of the callback.
	 * @param connection The connection the transaction runs on.
	 * @param tx The transaction handle.
	 * @param callback The function to run.
	 * @returns The return value of the callback.
	 */
	public runInTransaction<T>(connection: TConnection, tx: TConnection, callback: () => T): T {
		const store = Application.context.getStore();
		const transactions = new Map(
			store?.get('db:transactions') as Map<TConnection, TConnection> | undefined
		);
		transactions.set(connection, tx);

		const next = new Map(store);
		next.set('db:transactions', transactions);
		if (this.isDefaultConnection(connection)) next.set('db:tx', tx);

		return Application.context.run(next, callback);
	}

	/**
	 * Gets the transaction open on a connection in the current async context.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param connection The connection, as returned by {@link getBaseConnection}.
	 * @returns The transaction handle, or `undefined` if none is open.
	 */
	public getActiveTransaction(connection: TConnection): TConnection | undefined {
		const transactions = Application.context.getStore()?.get('db:transactions') as
			Map<TConnection, TConnection> | undefined;
		return transactions?.get(connection);
	}

	/**
	 * Checks whether a connection is the one the `default` name resolves to.
	 * @param connection The connection.
	 */
	private isDefaultConnection(connection: TConnection): boolean {
		return Service.get<TConnection>(AbstractDatabase.getConnectionName('default')) === connection;
	}

	/**
	 * Checks if a connection with the given name exists.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param name The name of the connection to check.
	 * @returns `true` if the connection exists, `false` otherwise.
	 */
	public connectionExists(name: string): boolean {
		return Service.exists(AbstractDatabase.getConnectionName(name));
	}

	/**
	 * Retrieves the default connection.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @returns The default connection.
	 */
	public getDefaultConnection(): TConnection {
		return this.getConnection('default');
	}

	/**
	 * Returns the raw underlying client for the given connection.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param name The connection name.
	 * @returns The raw client instance.
	 */
	public getRawClient(name: string = 'default'): unknown {
		return this.driver.getRawClient(this.getConnection(name));
	}
}
