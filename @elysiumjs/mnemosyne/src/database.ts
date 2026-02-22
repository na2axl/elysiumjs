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

import { Application, Service } from '@elysiumjs/core';

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
 * Manages named database connections using a driver. Connections are
 * registered in the service container and can be retrieved by name.
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
	 * Creates a service name for a database connection.
	 * @param name The name of the connection.
	 * @returns A service name for the connection.
	 */
	private getConnectionName(name: string): string {
		return `db.connection.${name}`;
	}

	/**
	 * Retrieves the connection with the given name.
	 *
	 * For the default connection, checks the async context for a
	 * transaction handle (`db:tx`) before falling back to the service container.
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

		const serviceName = this.getConnectionName(name);
		if (!Service.exists(serviceName)) {
			// TODO: Use logger service here
			console.error(
				`No connection with name ${name} found. Please make sure to register the connection before using it.`
			);
			process.exit(1);
		}

		return Service.get<TConnection>(serviceName)!;
	}

	/**
	 * Creates and registers a new connection.
	 *
	 * This will make the registered connection available for dependency injection with
	 * the key `db.connection.{name}`, where `{name}` is replaced with the given name.
	 *
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param name The connection name.
	 * @param config The connection configuration.
	 * @returns The newly created and registered connection.
	 */
	public registerConnection(name: string, config: TConnectionConfig): TConnection {
		const serviceName = this.getConnectionName(name);
		if (Service.exists(serviceName)) {
			// TODO: Use logger service here
			console.error(`A connection with the name ${name} has already been registered.`);
			process.exit(1);
		}

		const connection = this.driver.createConnection(config);
		return Service.instance(serviceName, connection);
	}

	/**
	 * Checks if a connection with the given name exists.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param name The name of the connection to check.
	 * @returns `true` if the connection exists, `false` otherwise.
	 */
	public connectionExists(name: string): boolean {
		return Service.exists(this.getConnectionName(name));
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
	 * Sets the default connection.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param name The name of the connection to set as default.
	 * @returns The default connection.
	 */
	public setDefaultConnection(name: string): TConnection {
		const serviceName = this.getConnectionName('default');
		Service.remove(serviceName);
		return Service.instance(serviceName, this.getConnection(name));
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
