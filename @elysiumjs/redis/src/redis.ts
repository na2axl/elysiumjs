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
import type { RedisClientFactory, RedisConnection } from './connection';

import { Module, needsDefaultAlias, runAll, Service, ServiceNotFoundError } from '@elysiumjs/core';
import { omit } from 'radash';

import { bunRedis } from './connection';

/**
 * Properties used to create a new redis connection.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type RedisConnectionProps = { url: string } & Record<string, unknown>;

/**
 * Configuration of the {@link RedisModule}.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type RedisModuleConfig = {
	/** The name of the connection that `default` resolves to. */
	default: string;

	/**
	 * Creates the client of a connection. Defaults to {@link bunRedis}; pass another factory
	 * to plug in any other Redis client.
	 */
	client?: RedisClientFactory;

	/** The connections to declare, by name. */
	connections: Record<string, RedisConnectionProps>;
};

export namespace Redis {
	/**
	 * Creates a service name for a redis connection.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param name The name of the connection.
	 * @returns A service name for the connection.
	 */
	export const getConnectionName = (name: string) => {
		return `redis.connection.${name}`;
	};

	/**
	 * Retrieves the client for a redis connection declared by the {@link RedisModule}.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param name The name of the connection.
	 * @returns The {@link RedisConnection} for the connection with the given name.
	 * @throws {ServiceNotFoundError} If no connection with that name is declared.
	 */
	export const getConnection = (name: string = 'default') => {
		const client = Service.get<RedisConnection>(getConnectionName(name));
		if (client === null) throw new ServiceNotFoundError(getConnectionName(name));
		return client;
	};

	/**
	 * Checks if a redis connection with the given name exists.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param name The name of the connection to check.
	 * @returns `true` if the connection exists, `false` otherwise.
	 */
	export const connectionExists = (name: string) => {
		return Service.exists(getConnectionName(name));
	};

	/**
	 * Retrieves the default redis connection.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @returns The default redis connection.
	 */
	export const getDefaultConnection = () => {
		return getConnection('default');
	};
}

/**
 * Declares redis connections as global services named `redis.connection.{name}`, plus
 * `redis.connection.default` aliasing the configured default. Clients are created on first use.
 * @author Axel Nana <axel.nana@workbud.com>
 */
@Module.register<RedisModuleConfig>({
	services: (config) => {
		const alias = needsDefaultAlias('RedisModule', config);
		return [
			...Object.entries(config.connections).map(([name, props]) => ({
				name: Redis.getConnectionName(name),
				global: true,
				factory: () => (config.client ?? bunRedis)(props.url, omit(props, ['url']))
			})),
			...(alias
				? [
						{
							name: Redis.getConnectionName('default'),
							global: true,
							factory: (_config: unknown, get: <T>(name: string) => T) =>
								get<RedisConnection>(Redis.getConnectionName(config.default))
						}
					]
				: [])
		];
	}
})
export class RedisModule extends Module.configurable<RedisModuleConfig>({
	defaults: { default: 'default' },
	required: ['connections']
}) {
	/** Closes the clients that were created. */
	public override async onDestroy(): Promise<void> {
		const names = Object.keys(this.config.connections).map(Redis.getConnectionName);
		await runAll(
			names
				.filter((name) => Service.isConstructed(name))
				.map((name) => () => Service.get<RedisConnection>(name)?.close())
		);
	}
}
