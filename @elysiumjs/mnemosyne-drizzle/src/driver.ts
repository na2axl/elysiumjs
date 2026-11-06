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
import type { DrizzleDatabaseCache } from './cache';
import type { DrizzleConnection } from './database';

import { ElysiumError } from '@elysiumjs/core';

/**
 * What a driver connects with: the Drizzle options of the connection and its query cache.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type DrizzleDriverConfig = Omit<DrizzleConfig<Record<string, unknown>>, 'cache'> & {
	cache?: DrizzleDatabaseCache;
};

/**
 * Connects Drizzle to PostgreSQL through a client: Bun SQL (`/bun-sql`), postgres.js
 * (`/postgres-js`), node-postgres (`/node-postgres`) or Cloudflare Hyperdrive (`/hyperdrive`).
 * Implement it to plug in another client.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export interface DrizzleDriver {
	/** The name of the driver, for errors and logs. */
	readonly name: string;

	/**
	 * Creates the Drizzle database of a connection.
	 * @param config The Drizzle options and the query cache.
	 */
	connect(config: DrizzleDriverConfig): DrizzleConnection;

	/**
	 * Closes the client of a database the driver created.
	 * @param connection The database.
	 */
	close(connection: DrizzleConnection): Promise<void> | void;
}

/**
 * Raised when a connection sets no driver outside Bun, where the default Bun SQL driver is not
 * available.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class MissingDriverError extends ElysiumError {
	constructor(name: string) {
		super(
			`Connection "${name}" sets no driver, and the default Bun SQL driver runs on Bun only. ` +
				'Set `driver` to postgresJs() or nodePostgres() on Node.js, or hyperdrive() on ' +
				'Cloudflare Workers.'
		);
	}
}
