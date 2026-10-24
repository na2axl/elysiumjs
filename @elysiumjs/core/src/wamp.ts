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

import type { Class, Primitive } from 'type-fest';
import type { ModuleNode } from './module-graph';

import { Elysia } from 'elysia';
import { omit } from 'radash';
// @ts-expect-error The Wampy type definitions are not up to date
import Wampy from 'wampy';

import { Event } from './event';
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
	onChallenge?(method: string, extra: any): string | null;

	/**
	 * Callback for handling the WAMP connection open event.
	 */
	onOpen?(): void;

	/**
	 * Callback for handling the WAMP connection close event.
	 */
	onClose?(): void;

	/**
	 * Callback for handling the WAMP connection error event.
	 */
	onError?(): void;

	/**
	 * Callback for handling the WAMP connection reconnect event.
	 */
	onReconnect?(): void;

	/**
	 * Callback for handling the WAMP connection reconnect success event.
	 */
	onReconnectSuccess?(): void;
};

export type WampClient = {
	/**
	 * Disconnects from WAMP server. Clears all queues, subscriptions and calls.
	 * @author Axel Nana <axel.nana@workbud.com>
	 */
	disconnect(): Promise<void>;

	subscribe(
		topic: string,
		handler: WampSubscriptionHandler,
		options?: WampSubscriptionOptions
	): Promise<{
		topic: string;
		requestId: string;
		subscriptionId: string;
		subscriptionKey: string;
	}>;

	unsubscribe(
		subscriptionIdOrKey: string,
		handler?: WampSubscriptionHandler
	): Promise<{
		topic: string;
		requestId: string;
	}>;

	publish(
		topic: string,
		params?:
			| Primitive
			| Array<any>
			| Record<string, Primitive | Array<any>>
			| { argsList: Array<any>; argsDict: Record<string, any> },
		options?: {
			exclude?: number | number[];
			exclude_authid?: string | string[];
			exclude_authrole?: string | string[];
			eligible?: number | number[];
			eligible_authid?: string | string[];
			eligible_authrole?: string | string[];
			exclude_me?: boolean;
			disclose_me?: boolean;
			ppt_scheme?: string;
			ppt_serializer?: string;
			ppt_cipher?: string;
			ppt_keyid?: string;
		}
	): Promise<{
		topic: string;
		requestId: string;
		publicationId: string;
	}>;

	call(
		procedure: string,
		params?:
			| Primitive
			| Array<any>
			| Record<string, Primitive | Array<any>>
			| { argsList: Array<any>; argsDict: Record<string, any> },
		options?: {
			disclose_me?: boolean;
			progress_callback?(args: { argsList: Array<any>; argsDict: Record<string, any> }): void;
			timeout?: number;
			ppt_scheme?: string;
			ppt_serializer?: string;
			ppt_cipher?: string;
			ppt_keyid?: string;
		}
	): Promise<{
		details: Record<string, any>;
		argsList?: Array<any>;
		argsDict?: Record<string, any>;
	}>;

	cancel(requestId: string, options?: { mode?: 'kill' | 'killnowait' | 'skip' }): true;

	register(
		topic: string,
		handler: WampRegistrationHandler,
		options?: WampRegistrationOptions
	): Promise<{
		topic: string;
		requestId: string;
		registrationId: string;
	}>;

	unregister(registrationId: string): Promise<{
		topic: string;
		requestId: string;
	}>;
};

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
	const getConnectionName = (name: string) => {
		return `wamp.connection.${name}`;
	};

	/**
	 * Retrieves the client for a WAMP connection.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param name The name of the connection.
	 * @returns The Wampy client for the connection with the given name.
	 */
	export const getConnection = (name: string) => {
		if (!Service.exists(getConnectionName(name))) {
			// TODO: Use logger service here
			console.error(
				`No WAMP connection with name ${name} found. Please make sure to register the connection before using it.`
			);
			process.exit(1);
		}

		return Service.get<WampClient>(getConnectionName(name))!;
	};

	/**
	 * Creates and registers a new WAMP client.
	 *
	 * This will make the registered connection available for dependency injection with
	 * the key `wamp.connection.{name}`, where `{name}` is replaced with the given name.
	 *
	 * @author Axel Nana <axel.nana@workbud.com>
	 *
	 * @param name The name of the connection.
	 * @param config The configuration for the WAMP client.
	 * @returns The newly created and configured WAMP client for the given connection.
	 */
	export const registerConnection = (name: string, config: WampClientProps) => {
		if (Service.exists(getConnectionName(name))) {
			// TODO: Use logger service here
			console.error(
				`A WAMP connection with name ${name} already exists. Please ensure to register a new connection before overwriting it.`
			);
			process.exit(1);
		}

		const client = new Wampy(config.url, {
			ws: WampWebsocket,
			...omit(config, ['url']),
			onError() {
				config.onError?.();
				// TODO: Add more details like controller name and url
				Event.emit('elysium:error', new Error(`An error occurred in WAMP connection ${name}`));
			}
		});

		const maxRetries = config.maxRetries ?? 5;
		const retryInterval = config.retryInterval ?? 5000;
		let retryCount = 0;

		const tryConnect = async () => {
			try {
				await client.connect();
			} catch (e) {
				console.error(
					`Failed to connect to WAMP server (attempt ${retryCount + 1}/${maxRetries}):`,
					e
				);

				if (retryCount < maxRetries) {
					retryCount++;
					setTimeout(tryConnect, retryInterval);
				} else {
					console.error(`Max retry attempts (${maxRetries}) reached. Giving up.`);
					Event.emit(
						'elysium:error',
						new Error(`Failed to establish WAMP connection ${name} after ${maxRetries} attempts`)
					);
				}
			}
		};

		tryConnect();

		return Service.instance<WampClient>(getConnectionName(name), client);
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
	 * Sets the default WAMP connection.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param name The name of the connection to set as default.
	 * @returns The default WAMP connection.
	 */
	export const setDefaultConnection = (name: string) => {
		const serviceName = getConnectionName('default');
		Service.remove(serviceName);
		return Service.instance<WampClient>(serviceName, getConnection(name));
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

				const metadata = Reflect.getMetadata(Symbols.wamp, target) ?? {};

				const w = Wamp.getConnection(options.connection ?? 'default');

				const app = new Elysia({ name: `${node.id}:${target.name}` });

				app.onStart(async (_) => {
					const registrations: WampRegistration[] = metadata.registrations ?? [];
					const subscriptions: WampSubscription[] = metadata.subscriptions ?? [];

					for (const registration of registrations) {
						w.register(
							registration.topic,
							inModule(registration.handler),
							registration.options
						).then((r: { topic: string; requestId: string; registrationId: string }) => {
							// TODO: Use the logger service here
							console.log(`Registered ${registration.topic} with id ${r.registrationId}`);
						});
					}

					for (const subscription of subscriptions) {
						w.subscribe(
							subscription.topic,
							inModule(subscription.handler),
							subscription.options
						).then(
							(s: {
								topic: string;
								requestId: string;
								subscriptionId: string;
								subscriptionKey: string;
							}) => {
								// TODO: Use the logger service here
								console.log(`Subscribed ${subscription.topic} with id ${s.subscriptionId}`);
							}
						);
					}
				});

				return app;
			}

			Reflect.defineMetadata(Symbols.elysiaPlugin, handleWamp, target);
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
			const metadata = Reflect.getMetadata(Symbols.wamp, target.constructor) ?? {};

			metadata.registrations ??= [];
			metadata.registrations.push({
				topic,
				options,
				handler: descriptor.value as WampRegistrationHandler
			});

			Reflect.defineMetadata(Symbols.wamp, metadata, target.constructor);
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
			const metadata = Reflect.getMetadata(Symbols.wamp, target.constructor) ?? {};

			metadata.subscriptions ??= [];
			metadata.subscriptions.push({
				topic,
				options,
				handler: descriptor.value as WampRegistrationHandler
			});

			Reflect.defineMetadata(Symbols.wamp, metadata, target.constructor);
		};
	};
}
