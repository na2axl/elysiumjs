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

import type { Pool, PoolConfig } from 'pg';
import type { DrizzleConnection } from '../database';
import type { DrizzleDriver } from '../driver';
import type { PgPool } from '../migration-clients';

import { drizzle } from 'drizzle-orm/node-postgres';

import { nodePostgresMigrations } from '../migration-clients';

/**
 * Options of {@link nodePostgres}: a connection URL or pool options, or a pool.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type NodePostgresDriverOptions = { connection: string | PoolConfig } | { client: Pool };

/**
 * Connects with node-postgres (`pg`), on Node.js and Bun.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @param options The connection URL or pool options, or a pool.
 * @example
 * ```ts
 * import { nodePostgres } from '@elysiumjs/drizzle/node-postgres';
 *
 * DrizzleModule.with({ connections: { default: { driver: nodePostgres({ connection: url }) } } });
 * ```
 */
export const nodePostgres = (options: NodePostgresDriverOptions): DrizzleDriver => ({
	name: 'node-postgres',
	connect: (config) => drizzle({ ...config, ...options } as never) as unknown as DrizzleConnection,
	close: async (connection) => {
		await (connection.$client as Pool).end();
	},
	migrations: (connection) => nodePostgresMigrations(connection.$client as PgPool)
});
