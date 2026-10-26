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

import type { Class } from 'type-fest';
import type { ModuleNode } from './module-graph';

import { Elysia } from 'elysia';
import { omit } from 'radash';
import Wampy from 'wampy';

import { needsDefaultAlias, runAll } from './connections';
import { Container } from './container';
import { ServiceNotFoundError } from './errors';
import { Event } from './event';
import { getLogger } from './logger';
import { Metadata } from './metadata';
import { Module } from './module';
import { ModuleContext } from './module-context';
import { Service } from './service';
import { nextTick, Symbols } from './utils';

// FIXME: Temporary solution for Bun to properly fill the protocol field. Remove this once oven-sh/bun#18744 is fixed.
class WampWebsocket extends WebSocket {
	public constructor(
		url: string,
		private readonly protocols?: string | string[]
	) {
		super(url, protocols);
	}

	public get protocol(): string {
		return this.protocols?.[0] ?? 'wamp.2.json';
	}
}

/**
 * Options used to register a WAMP RPC for invocation.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type WampRegistrationOptions = {
	/**
	 * The match policy to use for the registration.
	 * @default 'exact'
	 */
	match?: 'prefix' | 'exact' | 'wildcard';

	/**
	 * The invocation policy to use for the registration.
	 * @default 'single'
	 */
	invoke?: 'single' | 'first' | 'last' | 'roundrobin' | 'random';
};

/**
 * Options used to subscribe to a WAMP topic.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type WampSubscriptionOptions = Omit<WampRegistrationOptions, 'invoke'>;

/**
 * Properties required when declaring a WAMP controller using the `@wamp()` decorator.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type WampProps = {
	/**
	 * The name of the connection to use. This connection must be registered in the application properties.
	 * @default 'default'
	 */
	connection?: string;
};

/**
 * Properties required when declaring a WAMP client in the application properties.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type WampClientProps = {
	/**
	 * The URL to the WAMP server.
	 */
	url: string;

	/**
	 * The name of the realm to connect to.
	 */
	realm: string;

	/**
	 * Whether to automatically reconnect to the WAMP server on connection loss.
	 */
	autoReconnect?: boolean;

	/**
	 * The maximum number of times to retry connecting to the WAMP server.
	 */
	maxRetries?: number;

	/**
	 * The interval to wait between retries when connecting to the WAMP server.
	 */
	retryInterval?: number;

	/**
	 * The authentication ID to use in challenges.
	 */
	authid?: string;

	/**
	 * An array of supported authentication methods.
	 */
	authmethods?: string[];

	/**
	 * Callback for handling WAMP authentication challenges.
	 * @param method The authentication method.
	 * @param extra Authentication metadata.
	 */
	onChallenge?(method: string, extra: Record<string, unknown>): string | Promise<string>;

	/**
	 * Called once the first connection is established; not on wampy reconnects.
	 */
	onOpen?(): void | Promise<void>;

	/**
	 * Callback for handling the WAMP connection close event.
	 */
	onClose?(): void;

	/**
	 * Callback for handling the WAMP connection error event.
	 */
	onError?(error: Error): void;

	/**
	 * Callback for handling the WAMP connection reconnect event.
	 */
	onReconnect?(): void;

	/**
	 * Callback for handling the WAMP connection reconnect success event.
	 */
	onReconnectSuccess?(details: Record<string, unknown>): void;
};

/**
 * The WAMP client, as provided by Wampy.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type WampClient = Wampy;

/**
 * Data sent to a WAMP RPC.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type WampRegistrationHandlerArgs<TList = any[], TDict = any> = {
	/**
	 * The arguments passed to the RPC or subscription.
	 */
	argsList: TList;

	/**
	 * The keyword arguments passed to the RPC or subscription.
	 */
	argsDict: TDict;

	/**
	 * The WAMP details object.
	 */
	details: {
		receive_progress?: boolean;
		trustlevel?: number;
	};

	/**
	 * The result handler for the RPC. Use this to send progressive results.
	 * @param value
	 */
	result_handler: (value: any) => void;

	/**
	 * The error handler for the RPC when working with progressive results.
	 * @param error The thrown error.
	 */
	error_handler: (error: any) => void;
};

/**
 * Data sent to a WAMP subscription.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type WampSubscriptionHandlerArgs = Omit<
	WampRegistrationHandlerArgs,
	'result_handler' | 'error_handler'
>;

/**
 * The WAMP RPC handler function.
 * @author Axel Nana <axel.nana@workbud.com>
 * @param data The data sent to the handler.
 */
export type WampRegistrationHandler = <T = any>(data: WampRegistrationHandlerArgs) => T;

/**
 * The WAMP subscription handler function.
 * @author Axel Nana <axel.nana@workbud.com>
 * @param data The data sent to the handler.
 */
export type WampSubscriptionHandler = <T = any>(data: WampSubscriptionHandlerArgs) => T;

/**
 * Metadata for a WAMP RPC.
 * @author Axel Nana <axel.nana@workbud.com>
 */
type WampRegistration = {
	/**
	 * The topic to register the RPC for.
	 */
	topic: string;

	/**
	 * The registration options for the RPC.
	 */
	options?: WampRegistrationOptions;

	/**
	 * The RPC handler function.
	 */
	handler: WampRegistrationHandler;
};

/**
 * Metadata for a WAMP subscription.
 * @author Axel Nana <axel.nana@workbud.com>
 */
type WampSubscription = {
	/**
	 * The topic to subscribe to.
	 */
	topic: string;

	/**
	 * The subscription options for the subscription.
	 */
	options?: WampSubscriptionOptions;

	/**
	 * The subscription handler function.
	 */
	handler: WampSubscriptionHandler;
};

export namespace Wamp {
	/**
	 * Creates a service name for a WAMP connection.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param name The name of the connection.
	 * @returns A service name for the connection.
	 */
	export const getConnectionName = (name: string) => {
		return `wamp.connection.${name}`;
	};

	/**
	 * Retrieves the client for a WAMP connection declared by the {@link WampModule}.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param name The name of the connection.
	 * @returns The Wampy client for the connection with the given name.
	 * @throws {ServiceNotFoundError} If no connection with that name is declared.
	 */
	export const getConnection = (name: string = 'default') => {
		const client = Service.get<WampClient>(getConnectionName(name));
		if (client === null) throw new ServiceNotFoundError(getConnectionName(name));
		return client;
	};

	/**
	 * Checks if a WAMP connection with the given name exists.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param name The name of the connection.
	 * @returns `true` if the connection exists, `false` otherwise.
	 */
	export const connectionExists = (name: string) => {
		return Service.exists(getConnectionName(name));
	};

	/**
	 * Retrieves the default WAMP connection.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @returns The default WAMP connection.
	 */
	export const getDefaultConnection = () => {
		return getConnection('default');
	};

	/**
	 * Creates a WAMP client and starts connecting it, retrying on failure.
	 * @author Axel Nana <axel.nana@workbud.com>
	 */
	export const createClient = (name: string, config: WampClientProps): WampClient => {
		const client = new Wampy(config.url, {
			ws: WampWebsocket,
			...omit(config, ['url', 'onOpen']),
			onError(error) {
				config.onError?.(error);
				Event.emit(
					'elysium:error',
					new Error(
						`An error occurred in WAMP connection ${name} (${config.url}): ${error.message}`,
						{
							cause: error
						}
					)
				);
			}
		});

		const maxRetries = config.maxRetries ?? 5;
		const retryInterval = config.retryInterval ?? 5000;
		let retryCount = 0;
		let closed = false;
		let timer: ReturnType<typeof setTimeout> | undefined;

		// Stops the retry loop when the client is disconnected for good.
		const disconnect = client.disconnect.bind(client);
		client.disconnect = () => {
			closed = true;
			clearTimeout(timer);
			return disconnect();
		};

		const tryConnect = async () => {
			if (closed) return;
			try {
				await client.connect();
			} catch (error) {
				if (retryCount < maxRetries) {
					getLogger().warn('Failed to connect to WAMP server, retrying', {
						connection: name,
						attempt: retryCount + 1,
						maxRetries,
						error
					});
					retryCount++;
					timer = setTimeout(tryConnect, retryInterval);
				} else {
					const attempts = retryCount + 1;
					getLogger().error('Failed to connect to WAMP server, giving up', {
						connection: name,
						attempts,
						maxRetries,
						error
					});
					Event.emit(
						'elysium:error',
						new Error(`Failed to establish WAMP connection ${name} after ${attempts} attempts`)
					);
				}
				return;
			}

			// Outside the retry try, so that a failing onOpen does not trigger a reconnect.
			if (closed) return;
			try {
				await config.onOpen?.();
			} catch (error) {
				Event.emit('elysium:error', error);
			}
		};

		tryConnect();

		return client;
	};

	/**
	 * Marks a class as a WAMP controller.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param options The decorator options.
	 */
	export const controller = (options: WampProps) => {
		return function (target: Class<any>) {
			async function handleWamp(node: ModuleNode): Promise<Elysia> {
				await nextTick();

				const controller = ModuleContext.run(node, () => Service.make(target));
				const inModule =
					(handler: (...args: any[]) => any) =>
					(...args: any[]) =>
						ModuleContext.run(node, () => handler.apply(controller, args));

				const metadata = Metadata.get(Symbols.wamp, target) ?? {};

				const connection = options.connection ?? 'default';
				const w = Wamp.getConnection(connection);

				const app = new Elysia({ name: `${node.id}:${target.name}` });

				app.onStart(async (_) => {
					const registrations: WampRegistration[] = metadata.registrations ?? [];
					const subscriptions: WampSubscription[] = metadata.subscriptions ?? [];

					for (const { topic, handler, options } of registrations) {
						w.register(topic, inModule(handler), options).then(
							(r) => {
								getLogger().info('Registered WAMP RPC', {
									connection,
									topic,
									registrationId: r.registrationId
								});
							},
							(error) => {
								getLogger().error('Failed to register WAMP RPC', { connection, topic, error });
								Event.emit(
									'elysium:error',
									new Error(`Failed to register WAMP RPC ${topic} on connection ${connection}`, {
										cause: error
									})
								);
							}
						);
					}

					for (const { topic, handler, options } of subscriptions) {
						w.subscribe(topic, inModule(handler), options).then(
							(s) => {
								getLogger().info('Subscribed to WAMP topic', {
									connection,
									topic,
									subscriptionId: s.subscriptionId
								});
							},
							(error) => {
								getLogger().error('Failed to subscribe to WAMP topic', {
									connection,
									topic,
									error
								});
								Event.emit(
									'elysium:error',
									new Error(
										`Failed to subscribe to WAMP topic ${topic} on connection ${connection}`,
										{ cause: error }
									)
								);
							}
						);
					}
				});

				return app;
			}

			Metadata.define(Symbols.elysiaPlugin, handleWamp, target);
		};
	};

	/**
	 * Registers a method as a WAMP RPC.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param topic The RPC topic to register.
	 * @param options The registration options.
	 */
	export const register = (topic: string, options?: WampRegistrationOptions): MethodDecorator => {
		return function (target, _propertyKey, descriptor) {
			const metadata = Metadata.get(Symbols.wamp, target.constructor) ?? {};

			metadata.registrations ??= [];
			metadata.registrations.push({
				topic,
				options,
				handler: descriptor.value as WampRegistrationHandler
			});

			Metadata.define(Symbols.wamp, metadata, target.constructor);
		};
	};

	/**
	 * Subscribes to a WAMP topic.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param topic The topic to subscribe to.
	 * @param options The subscription options.
	 */
	export const subscribe = (topic: string, options?: WampSubscriptionOptions): MethodDecorator => {
		return function (target, _propertyKey, descriptor) {
			const metadata = Metadata.get(Symbols.wamp, target.constructor) ?? {};

			metadata.subscriptions ??= [];
			metadata.subscriptions.push({
				topic,
				options,
				handler: descriptor.value as WampRegistrationHandler
			});

			Metadata.define(Symbols.wamp, metadata, target.constructor);
		};
	};
}

/**
 * Configuration of the {@link WampModule}.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type WampModuleConfig = {
	/** The name of the connection that `default` resolves to. */
	default: string;

	/** The connections to declare, by name. */
	connections: Record<string, WampClientProps>;
};

/**
 * Declares WAMP connections as global services named `wamp.connection.{name}`, plus
 * `wamp.connection.default` aliasing the configured default. Clients are created on first use.
 * @author Axel Nana <axel.nana@workbud.com>
 */
@Module.register<WampModuleConfig>({
	services: (config) => {
		const alias = needsDefaultAlias('WampModule', config);
		return [
			...Object.entries(config.connections).map(([name, props]) => ({
				name: Wamp.getConnectionName(name),
				global: true,
				factory: () => Wamp.createClient(name, props)
			})),
			...(alias
				? [
						{
							name: Wamp.getConnectionName('default'),
							global: true,
							factory: (_config: unknown, get: <T>(name: string) => T) =>
								get<WampClient>(Wamp.getConnectionName(config.default))
						}
					]
				: [])
		];
	}
})
export class WampModule extends Module.configurable<WampModuleConfig>({
	defaults: { default: 'default' },
	required: ['connections']
}) {
	/** Disconnects the clients that were created. */
	public override async onDestroy(): Promise<void> {
		const names = Object.keys(this.config.connections).map(Wamp.getConnectionName);
		const clients = Container.constructed().filter(({ name }) => names.includes(name));
		await runAll(
			clients.map(
				({ instance }) =>
					() =>
						(instance as WampClient).disconnect()
			)
		);
	}
}
