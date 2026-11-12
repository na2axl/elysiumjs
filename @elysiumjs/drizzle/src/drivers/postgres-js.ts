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

import type { Options, PostgresType, Sql } from 'postgres';
import type { DrizzleConnection } from '../database';
import type { DrizzleDriver } from '../driver';
import type { TemplateClient } from '../migration-clients';

import { drizzle } from 'drizzle-orm/postgres-js';

import { templateClientMigrations } from '../migration-clients';

/**
 * Options of {@link postgresJs}: a connection URL or options, or a client.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type PostgresJsDriverOptions =
	| { connection: string | ({ url?: string } & Options<Record<string, PostgresType>>) }
	| { client: Sql };

/**
 * Connects with postgres.js (`postgres`), on Node.js, Bun and Cloudflare Workers.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @param options The connection URL or options, or a client.
 * @example
 * ```ts
 * import { postgresJs } from '@elysiumjs/drizzle/postgres-js';
 *
 * DrizzleModule.with({ connections: { default: { driver: postgresJs({ connection: url }) } } });
 * ```
 */
export const postgresJs = (options: PostgresJsDriverOptions): DrizzleDriver => ({
	name: 'postgres-js',
	connect: (config) => drizzle({ ...config, ...options } as never) as unknown as DrizzleConnection,
	close: async (connection) => {
		await (connection.$client as Sql).end();
	},
	migrations: (connection) => templateClientMigrations(connection.$client as TemplateClient)
});
