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
	 * For the default connection, checks the async context for a
	 * transaction handle (`db:tx`) before falling back to the service container.
	 * @throws {ServiceNotFoundError} If no connection with that name is registered.
	 *
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param name The connection name.
	 * @returns The connection with the given name.
	 */
	public getConnection(name: string = 'default'): TConnection {
		if (name === 'default') {
			const tx = Application.context.getStore()?.get('db:tx') as TConnection | undefined;
			if (tx) return tx;
		}

		const serviceName = AbstractDatabase.getConnectionName(name);
		const connection = Service.get<TConnection>(serviceName);
		if (connection === null) throw new ServiceNotFoundError(serviceName);

		return connection;
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
