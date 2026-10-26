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

import type { TenancyConfig } from '@elysiumjs/mnemosyne';
import type { DrizzleConnection, DrizzleConnectionProps } from './database';

import { Module, needsDefaultAlias, runAll, Service } from '@elysiumjs/core';
import {
	AbstractDatabase,
	DATABASE_TRANSACTION_SERVICE,
	MnemosyneModule,
	TENANCY_CONFIG_SERVICE,
	TENANCY_STRATEGY_SERVICE
} from '@elysiumjs/mnemosyne';

import { MigrationGenerateCommand } from './commands/migration_generate.command';
import { MigrationRunCommand } from './commands/migration_run.command';
import { Database } from './database';
import { DrizzleRLSTenancy, DrizzleSchemaTenancy } from './tenancy';

/**
 * Configuration of the {@link DrizzleModule}.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type DrizzleModuleConfig = {
	/** The name of the connection that `default` resolves to. */
	default: string;

	/** The connections to declare, by name. */
	connections: Record<string, DrizzleConnectionProps>;

	/** The tenancy configuration. Defaults to schema-based tenancy. */
	tenancy?: TenancyConfig;
};

/**
 * Declares Drizzle connections as global services named `db.connection.{name}`, plus
 * `db.connection.default` aliasing the configured default, `db.transaction` (used by
 * `@transactional` handlers), and registers the tenancy config and strategy. Connections are created on first use. Also provides the migration commands.
 * @author Axel Nana <axel.nana@workbud.com>
 */
@Module.register<DrizzleModuleConfig>({
	imports: [MnemosyneModule],
	commands: [MigrationGenerateCommand, MigrationRunCommand],
	services: (config) => {
		const alias = needsDefaultAlias('DrizzleModule', config);
		const tenancy = config.tenancy ?? { mode: 'schema' };
		return [
			...Object.entries(config.connections).map(([name, props]) => ({
				name: AbstractDatabase.getConnectionName(name),
				global: true,
				factory: () => Database.createConnection(props, name)
			})),
			...(alias
				? [
						{
							name: AbstractDatabase.getConnectionName('default'),
							global: true,
							factory: (_config: unknown, get: <T>(name: string) => T) =>
								get<DrizzleConnection>(AbstractDatabase.getConnectionName(config.default))
						}
					]
				: []),
			{
				name: DATABASE_TRANSACTION_SERVICE,
				global: true,
				factory:
					() =>
					<T>(callback: () => Promise<T>, connection?: string): Promise<T> =>
						Database.transaction(() => callback(), connection)
			},
			{ name: TENANCY_CONFIG_SERVICE, global: true, factory: () => tenancy },
			{
				name: TENANCY_STRATEGY_SERVICE,
				global: true,
				factory: () =>
					tenancy.mode === 'rls' ? new DrizzleRLSTenancy() : new DrizzleSchemaTenancy()
			}
		];
	}
})
export class DrizzleModule extends Module.configurable<DrizzleModuleConfig>({
	defaults: { default: 'default' },
	required: ['connections']
}) {
	/** Closes the clients of the connections that were created. */
	public override async onDestroy(): Promise<void> {
		const names = Object.keys(this.config.connections).map(AbstractDatabase.getConnectionName);
		await runAll(
			names
				.filter((name) => Service.isConstructed(name))
				.map((name) => () => Service.get<DrizzleConnection>(name)?.$client.close())
		);
	}
}
