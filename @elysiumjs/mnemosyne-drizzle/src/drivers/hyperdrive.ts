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

import type { DrizzleConnection } from '../database';
import type { DrizzleDriver, DrizzleDriverConfig } from '../driver';

import { Workers } from '@elysiumjs/runtime-workers';

import { MissingMigrationsError } from '../driver';

/**
 * A Hyperdrive binding, as Cloudflare Workers pass it.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type HyperdriveBinding = { readonly connectionString: string };

/**
 * Options of {@link hyperdrive}.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type HyperdriveDriverOptions = {
	/** The name of the Hyperdrive binding, as declared in the wrangler config. */
	binding: string;
	/**
	 * The driver that connects to the connection string of the binding, such as
	 * `(url) => postgresJs({ connection: { url, max: 5, fetch_types: false } })`.
	 */
	driver: (connectionString: string) => DrizzleDriver;
};

/**
 * Connects through a Cloudflare Hyperdrive binding. A Worker cannot reuse a socket opened in
 * another invocation, so the database opens a client per invocation (request, queue batch or
 * scheduled event) on first use. The runtime closes its sockets when the invocation ends, and
 * Hyperdrive pools the connections to the database.
 * @author Axel Nana <axel.nana@workbud.com>
 * @param options The binding name and the client driver.
 * @example
 * ```ts
 * import { hyperdrive } from '@elysiumjs/mnemosyne-drizzle/hyperdrive';
 * import { postgresJs } from '@elysiumjs/mnemosyne-drizzle/postgres-js';
 *
 * DrizzleModule.with({
 * 	connections: {
 * 		default: {
 * 			driver: hyperdrive({
 * 				binding: 'HYPERDRIVE',
 * 				driver: (url) => postgresJs({ connection: { url, max: 5, fetch_types: false } })
 * 			})
 * 		}
 * 	}
 * });
 * ```
 */
export const hyperdrive = (options: HyperdriveDriverOptions): DrizzleDriver => ({
	name: 'hyperdrive',
	connect: (config) => invocationDatabase(options, config),
	close: () => {},
	migrations: (connection) => {
		const { connectionString } = Workers.binding<HyperdriveBinding>(options.binding);
		const migrations = options.driver(connectionString).migrations?.(connection);
		if (!migrations) throw new MissingMigrationsError('hyperdrive');
		return migrations;
	}
});

/** A database that forwards to the database of the current invocation, opened on first use. */
const invocationDatabase = (
	options: HyperdriveDriverOptions,
	config: DrizzleDriverConfig
): DrizzleConnection => {
	const databases = new WeakMap<object, DrizzleConnection>();
	const current = (): DrizzleConnection => {
		const context = Workers.context();
		let database = databases.get(context);
		if (!database) {
			const { connectionString } = Workers.binding<HyperdriveBinding>(options.binding);
			database = options.driver(connectionString).connect(config);
			databases.set(context, database);
		}
		return database;
	};

	// Properties set on the proxy (such as the cache's transaction wrapper) stay on it; the rest
	// come from the database of the invocation.
	return new Proxy({} as DrizzleConnection, {
		get(target, property) {
			if (Object.hasOwn(target, property)) return Reflect.get(target, property);
			const database = current();
			const value = Reflect.get(database, property, database);
			return typeof value === 'function' ? value.bind(database) : value;
		},
		has(target, property) {
			return Object.hasOwn(target, property) || property in current();
		},
		getPrototypeOf() {
			return Object.getPrototypeOf(current());
		}
	});
};
