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

import type { SQL } from 'bun';
import type { DrizzleConnection } from '../database';
import type { DrizzleDriver } from '../driver';
import type { TemplateClient } from '../migration-clients';

import { drizzle } from 'drizzle-orm/bun-sql';

import { templateClientMigrations } from '../migration-clients';

/**
 * Options of {@link bunSql}: a connection URL or options, or a client.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type BunSqlDriverOptions =
	{ connection: string | ({ url?: string } & SQL.Options) } | { client: SQL };

/**
 * Connects with Bun's built-in SQL client. Runs on Bun only.
 * @author Axel Nana <axel.nana@workbud.com>
 * @param options The connection URL or options, or a client.
 * @example
 * ```ts
 * import { bunSql } from '@elysiumjs/mnemosyne-drizzle/bun-sql';
 *
 * DrizzleModule.with({ connections: { default: { driver: bunSql({ connection: url }) } } });
 * ```
 */
export const bunSql = (options: BunSqlDriverOptions): DrizzleDriver => ({
	name: 'bun-sql',
	connect: (config) => drizzle({ ...config, ...options } as never) as unknown as DrizzleConnection,
	close: async (connection) => {
		await (connection.$client as SQL).close();
	},
	migrations: (connection) => templateClientMigrations(connection.$client as TemplateClient)
});
