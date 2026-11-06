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

import type { Context as ElysiaContext, SSEPayload } from 'elysia';
import type { Class, MergeDeep } from 'type-fest';
import type { Static, TSchema } from 'typebox';
import type { AppHttpContext } from '.';
import type { FilterClass, FilterLevel } from './filter';
import type { InterceptorClass, InterceptorContext, InterceptorLevel } from './interceptor';
import type { Middleware } from './middleware';
import type { Module } from './module';
import type { ModuleNode } from './module-graph';
import type { AppRateLimitOptions, RateLimitOptions } from './rate-limit';
import type { ServiceToken } from './token';

import { Elysia, sse as esse, t } from 'elysia';
import { assign, isEmpty, objectify } from 'radash';

import { Application } from './app';
import { Container } from './container';
import { Event } from './event';
import { FILTER_LEVELS, routeFilterLevels } from './filter';
import { runInterceptors } from './interceptor';
import { Metadata } from './metadata';
import { applyMiddlewares, executeMiddlewareChain, makeMiddlewares } from './middleware';
import { ModuleContext } from './module-context';
import { enforceRateLimit, rateLimitOf } from './rate-limit';
import { isSerializable, readFields, Resource } from './resource';
import { Runtime } from './runtime';
import { Service } from './service';
import { nextTick, Symbols } from './utils';

/**
 * A route is a string that starts with a forward slash.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type Route = `/${string}`;

/**
 * An HTTP method name.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type HTTPMethod = string;

/**
 * A function computing a value from the request context, used by custom parameter decorators.
 * @author Axel Nana <axel.nana@workbud.com>
 */
type Handler = (c: Context) => unknown;

/**
 * A class for validating data against a schema.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type ValidatorClass<T extends TSchema = TSchema> = {
	/**
	 * The validation schema. This schema is automatically checked against the input data during
	 * the validation stage of the HTTP request.
	 */
	readonly schema: T;

	/**
	 * Whether the request should be authorized before validation. If the request is not authorized,
	 * the validation will be skipped.
	 */
	authorize(ctx: Context<Static<T>>): Promise<boolean>;

	/**
	 * Processes custom validation logic. This method is called after the validation schema is checked
	 * against the input data. So it's safe to assume that the schema is valid.
	 * @param data The input data to validate.
	 * @returns Whether the input data is valid.
	 */
	validate(ctx: Context<Static<T>>): Promise<boolean>;
};

/**
 * A function that handles an HTTP request.
 * @author Axel Nana <axel.nana@workbud.com>
 */
type HttpRequestHandler = <TResult = unknown, TArgs extends any[] = unknown[]>(
	...args: TArgs
) => Promise<TResult>;

/**
 * Stores metadata for an HTTP request handler.
 * @author Axel Nana <axel.nana@workbud.com>
 */
type HttpRequestHandlerMetadata = {
	/**
	 * The name of the controller method handling the route.
	 */
	name: string;

	/**
	 * The path of the HTTP route.
	 */
	path: Route;

	/**
	 * The HTTP method of the handler.
	 */
	method: HTTPMethod;

	/**
	 * The request handler function.
	 */
	handler: HttpRequestHandler;

	/**
	 * The response schema.
	 */
	response?: TSchema | Record<number, TSchema>;

	/**
	 * The request body schema.
	 */
	body?: { schema?: TSchema; validator?: ValidatorClass; index: number };

	/**
	 * The request query schema.
	 */
	query?: { schema?: TSchema; index: number };

	/**
	 * The request parameters.
	 */
	params: Array<{ slug: string; schema: TSchema; index: number }>;

	/**
	 * The raw context for the handler.
	 */
	rawContext?: { index: number };

	/**
	 * Custom decorators for the handler.
	 */
	customDecorators: Array<{ handler: Handler; index: number }>;

	/**
	 * The middlewares for the handler.
	 */
	middlewares: Array<Class<Middleware>>;

	/**
	 * The OpenAPI's operationId for the handler.
	 */
	operationId?: string;

	/**
	 * The OpenAPI's description for the handler.
	 */
	description?: string;

	/**
	 * The list of services injected in the handler.
	 */
	services: Array<{ token: ServiceToken; index: number }>;

	/**
	 * Whether the request handler is transactional.
	 *
	 * If set to `true`, a new transaction will be created and all the database
	 * queries running for that handler will be wrapped in that transaction.
	 */
	transactional?: boolean;

	/** Whether the handler result is serialized through the response schema. */
	serialize?: boolean;

	/** The exception filters of the route. */
	filters?: FilterClass[];

	/** The interceptors around the handler. */
	interceptors?: InterceptorClass[];
};

/**
 * Parameters for registering an HTTP request handler.
 * @author Axel Nana <axel.nana@workbud.com>
 */
type HttpRequestHandlerRegistrationProps = Pick<
	HttpRequestHandlerMetadata,
	| 'path'
	| 'method'
	| 'handler'
	| 'response'
	| 'operationId'
	| 'description'
	| 'transactional'
	| 'serialize'
	| 'filters'
	| 'interceptors'
> & {
	target: Object;
	propertyKey: string | symbol;
};

/**
 * Metadata for the HTTP context.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type Singleton<TController = unknown, TModule extends Module = Module> = MergeDeep<
	AppHttpContext,
	{
		decorator: {
			[key: string]: unknown;

			/**
			 * The controller instance.
			 */
			controller: () => TController;

			/**
			 * The module instance.
			 */
			module: TModule;
		};

		derive: {
			/**
			 * The tenant ID.
			 */
			readonly tenant: string;
		};
	}
>;

/**
 * The Elysia context with the controller injected.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type Context<
	TBody = unknown,
	TController = unknown,
	TModule extends Module = Module
> = ElysiaContext<
	{
		body: TBody;
	},
	Singleton<TController, TModule>
>;

export type ElysiaApp = Elysia<Route, 'local', Singleton>;

/**
 * Iterates an async generator with every step running in the context of a module.
 * The body of a generator runs when it is iterated, not when it is created.
 */
async function* iterateInModule<T>(node: ModuleNode, generator: AsyncGenerator<T>) {
	let finished = false;
	try {
		while (true) {
			const step = await ModuleContext.run(node, () => generator.next());
			if (step.done) {
				finished = true;
				return;
			}
			yield step.value;
		}
	} catch (error) {
		finished = true;
		throw error;
	} finally {
		// Closed early (cancelled stream, disconnected client): let the handler clean up.
		if (!finished) await ModuleContext.run(node, () => generator.return(undefined));
	}
}

/** Thrown inside the scope of a generator closed before its end, so that the scope fails. */
const cancellation = new Error('The stream was closed before its end.');

/**
 * Iterates a generator inside a scope that stays open until the iteration ends.
 *
 * Every step of the generator runs inside `scope`, so it sees the async context the scope sets up.
 * Callback-style scopes such as database transactions would otherwise end (and commit) as soon as
 * the generator object is created, before its body has run. The scope ends successfully when the
 * generator is exhausted. It fails when the generator throws, or is cancelled: closed early by the
 * consumer, or `signal` aborted (the client disconnected), even while a step is still running.
 * Transactions therefore roll back unless the whole stream was sent. An error raised by the scope
 * itself (such as a failed commit) is rethrown to the consumer.
 * @param scope Runs its body inside the scope and settles when the scope ends.
 * @param start Creates the generator to iterate. Called inside the scope.
 * @param signal Aborted when the stream is cancelled, such as `request.signal`.
 */
async function* iterateInScope<T>(
	scope: (body: () => Promise<void>) => Promise<unknown>,
	start: () => AsyncGenerator<T>,
	signal?: AbortSignal
): AsyncGenerator<T> {
	const cancelled = Promise.withResolvers<never>();
	cancelled.promise.catch(() => {});
	const cancel = () => cancelled.reject(cancellation);
	if (signal?.aborted) cancel();
	signal?.addEventListener('abort', cancel, { once: true });

	const pending = () => {
		const deferred = Promise.withResolvers<IteratorResult<T>>();
		// Rejections reach the consumer through `finished` when nobody waits on this step.
		deferred.promise.catch(() => {});
		return deferred;
	};

	let resume = Promise.withResolvers<boolean>();
	let deliver = pending();

	const finished = scope(async () => {
		const generator = start();
		let stepping = false;
		try {
			while (await Promise.race([resume.promise, cancelled.promise])) {
				resume = Promise.withResolvers();
				stepping = true;
				const step = await Promise.race([generator.next(), cancelled.promise]);
				stepping = false;
				const current = deliver;
				deliver = pending();
				current.resolve(step);
				if (step.done) return;
			}
		} catch (error) {
			if (error !== cancellation) throw error;
			// A running step cannot be interrupted: the generator is closed once it settles,
			// after the scope ends. Otherwise it is closed now, inside the scope.
			if (stepping) {
				generator.return(undefined).catch((error) => Event.emit('elysium:error', error));
			} else {
				await generator.return(undefined);
			}
			throw error;
		}
		await generator.return(undefined);
		throw cancellation;
	});
	finished.catch((error) => deliver.reject(error));

	let completed = false;
	try {
		while (true) {
			const current = deliver;
			resume.resolve(true);
			const step = await current.promise.catch((error) => {
				if (error === cancellation) return { done: true, value: undefined } as const;
				throw error;
			});
			if (step.done) {
				completed = true;
				return;
			}
			yield step.value;
		}
	} finally {
		signal?.removeEventListener('abort', cancel);
		if (!completed) resume.resolve(false);
		await finished.catch((error) => {
			if (error !== cancellation) throw error;
		});
	}
}

/**
 * Name of the global service running a callback in a database transaction, used by
 * `@transactional` handlers. Provided by database modules such as `DrizzleModule`.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export const DATABASE_TRANSACTION_SERVICE = 'db.transaction';

/**
 * Runs a callback in a database transaction registered in the application context.
 */
type TransactionRunner = <T>(callback: () => Promise<T>) => Promise<T>;

/**
 * Gets the transaction runner provided by the database module.
 * @throws {Error} If no database module provides one.
 */
const getTransactionRunner = (): TransactionRunner => {
	const runner = Service.get<TransactionRunner>(DATABASE_TRANSACTION_SERVICE);
	if (!runner) {
		throw new Error(
			`Transactional handlers need the "${DATABASE_TRANSACTION_SERVICE}" service. ` +
				'Import a database module (such as DrizzleModule) in the application.'
		);
	}
	return runner;
};

const registerHttpRequestHandler = (props: HttpRequestHandlerRegistrationProps) => {
	const body = Metadata.get('http:body', props.target, props.propertyKey);
	const params = Metadata.get('http:params', props.target, props.propertyKey) ?? [];
	const query = Metadata.get('http:query', props.target, props.propertyKey);
	const rawContext = Metadata.get('http:rawContext', props.target, props.propertyKey);
	const customDecorators =
		Metadata.get('http:customDecorators', props.target, props.propertyKey) ?? [];
	const middlewares = Metadata.get(Symbols.middlewares, props.target, props.propertyKey) ?? [];
	const services = Metadata.get(Symbols.services, props.target, props.propertyKey) ?? [];

	const {
		path,
		method,
		handler,
		target,
		response,
		operationId,
		description,
		transactional,
		serialize,
		filters,
		interceptors
	} = props;

	const metadata: HttpRequestHandlerMetadata[] =
		Metadata.get(Symbols.http, target.constructor) ?? [];

	metadata.push({
		name: String(props.propertyKey),
		path,
		method,
		body,
		params,
		query,
		customDecorators,
		rawContext,
		handler,
		middlewares,
		response,
		operationId,
		description,
		services,
		transactional,
		serialize,
		filters,
		interceptors
	});

	Metadata.define(Symbols.http, metadata, target.constructor);
};

/**
 * The scope of an HTTP controller.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export enum HttpControllerScope {
	/**
	 * The controller is instantiated once in the server and used for every request.
	 */
	SERVER,

	/**
	 * A new instance of the controller is created for each request.
	 */
	REQUEST
}

/**
 * Properties required when declaring an HTTP controller using the `@http()` decorator.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type HttpControllerProps = {
	/**
	 * The path of the HTTP route.
	 */
	path: Route;

	/**
	 * The scope of the HTTP controller.
	 * @default HttpControllerScope.SERVER
	 */
	scope?: HttpControllerScope;

	/**
	 * The list of tags for the controller.
	 * Used in OpenAPI documentation.
	 */
	tags?: Array<string>;

	/**
	 * Whether to create a database transaction for all the queries executed
	 * for all the request handlers in this controller.
	 */
	transactional?: boolean;

	/**
	 * Exception filters for every route of the controller. They run after the filters of the route,
	 * and before those of the module and the app.
	 */
	filters?: FilterClass[];

	/**
	 * Interceptors around every handler of the controller, inside those of the module and the app,
	 * and outside those of the route.
	 */
	interceptors?: InterceptorClass[];
};

/**
 * Properties required when declaring an HTTP request handler.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type RequestHandlerDecoratorProps = {
	/**
	 * The HTTP method of the handler.
	 */
	method?: HTTPMethod;

	/**
	 * The path of the HTTP route.
	 */
	path?: Route;

	/**
	 * The schema of the response body.
	 */
	response?: TSchema | Record<number, TSchema>;

	/**
	 * The operation ID for the handler.
	 * Used in OpenAPI documentation.
	 */
	operationId?: string;

	/**
	 * The description for the handler.
	 * Used in OpenAPI documentation.
	 */
	description?: string;

	/**
	 * Whether to create a database transaction for all the queries executed
	 * for this request handler.
	 */
	transactional?: boolean;

	/**
	 * Whether to serialize the handler result through the `response` schema: undeclared and hidden
	 * fields are stripped, dates become ISO strings, and `?fields=` selects fields. Defaults to
	 * `true` when the route has a `response` schema.
	 */
	serialize?: boolean;

	/** Exception filters for this route. They run before those of the controller. */
	filters?: FilterClass[];

	/** Interceptors around this handler, inside those of the controller. */
	interceptors?: InterceptorClass[];
};

/**
 * A route of an HTTP controller, as `Http.describe()` reports it.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type HttpRouteDescription = {
	/** The name of the controller method handling the route. */
	name: string;
	/** The HTTP method, in upper case. Server-sent events routes use `GET`. */
	method: string;
	/** The path of the route, relative to the controller path. */
	path: Route;
	/** Whether the route streams server-sent events. */
	sse: boolean;
	/** The index of the method parameter receiving the request body. */
	body?: number;
	/** The index of the method parameter receiving the query. */
	query?: number;
	/** The method parameters receiving URL parameters. */
	params: Array<{ slug: string; index: number }>;
};

/**
 * An HTTP controller, as `Http.describe()` reports it.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type HttpControllerDescription = {
	/** The path of the controller. */
	path: Route;
	/** The routes of the controller. */
	routes: HttpRouteDescription[];
};

/** The module level of interceptors, shared by every controller of a module. */
const moduleInterceptorLevels = new WeakMap<ModuleNode, InterceptorLevel>();

const moduleInterceptorLevel = (node: ModuleNode): InterceptorLevel => {
	let level = moduleInterceptorLevels.get(node);
	if (!level) {
		moduleInterceptorLevels.set(
			node,
			(level = { interceptors: node.props.interceptors ?? [], node })
		);
	}
	return level;
};

/** The app level of interceptors, from the running application's `interceptors` option. */
const appInterceptorLevels = new WeakMap<object, InterceptorLevel>();

const appInterceptorLevel = (): InterceptorLevel => {
	const app = Service.get<object>('elysium.app');
	if (!app) return { interceptors: [], node: null };
	let level = appInterceptorLevels.get(app);
	if (!level) {
		const interceptors = Metadata.get(Symbols.app, app.constructor)?.interceptors ?? [];
		appInterceptorLevels.set(app, (level = { interceptors, node: null }));
	}
	return level;
};

/** The rate limit options of the running application. */
const appRateLimit = (): AppRateLimitOptions | undefined => {
	const app = Service.get<object>('elysium.app');
	return app ? Metadata.get(Symbols.app, app.constructor)?.rateLimit : undefined;
};

/** The limit of the application for routes that set none, when it gives a window and a max. */
const appDefaultRateLimit = (): RateLimitOptions | undefined => {
	const options = appRateLimit();
	return options?.window !== undefined && options.max !== undefined
		? (options as RateLimitOptions)
		: undefined;
};

/** Joins a controller path and a route path into the route's full path. */
const joinPath = (base: string, path: string): string =>
	`/${[base, path]
		.map((part) => part.replace(/^\/+|\/+$/g, ''))
		.filter(Boolean)
		.join('/')}`;

/** The module level of exception filters, shared by every controller of a module. */
const moduleFilterLevels = new WeakMap<ModuleNode, FilterLevel>();

const moduleFilterLevel = (node: ModuleNode): FilterLevel => {
	let level = moduleFilterLevels.get(node);
	if (!level) moduleFilterLevels.set(node, (level = { filters: node.props.filters ?? [], node }));
	return level;
};

export namespace Http {
	/**
	 * Describes the routes of an HTTP controller, for tools such as the route type generator.
	 * Route decorators register their routes on the next tick, so call it after importing the
	 * controller and awaiting a tick.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param controller The controller class.
	 * @returns The description, or `undefined` when the class is not an HTTP controller.
	 */
	export const describe = (controller: Class<any>): HttpControllerDescription | undefined => {
		const props: HttpControllerProps | undefined = Metadata.get('http:controller', controller);
		if (!props) return undefined;
		const metadata: HttpRequestHandlerMetadata[] = Metadata.get(Symbols.http, controller) ?? [];
		return {
			path: props.path ?? '/',
			routes: metadata.map((route) => {
				const sse = route.method === 'elysium:SSE';
				return {
					name: route.name,
					method: sse ? 'GET' : route.method.toUpperCase(),
					path: route.path,
					sse,
					body: route.body?.index,
					query: route.query?.index,
					params: route.params.map(({ slug, index }) => ({ slug, index }))
				};
			})
		};
	};

	/**
	 * Marks a class as an HTTP controller.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param props The decorator options.
	 */
	export const controller = (props: HttpControllerProps = { path: '/' }) => {
		return function (target: Class<any>) {
			async function handleHttp(node: ModuleNode): Promise<ElysiaApp> {
				await nextTick();

				props = assign({ path: '/', scope: HttpControllerScope.SERVER, tags: [] }, props);

				const app: ElysiaApp = new Elysia({
					prefix: props.path,
					name: `${node.id}:${target.name}`
				});

				const controllerFilters: FilterLevel = { filters: props.filters ?? [], node };
				const moduleFilters = moduleFilterLevel(node);

				// Read on the first request: the app is created after its controllers are decorated.
				let outer: InterceptorLevel[] | undefined;
				const outerInterceptors = (): InterceptorLevel[] =>
					(outer ??= [
						appInterceptorLevel(),
						moduleInterceptorLevel(node),
						{ interceptors: props.interceptors ?? [], node }
					].filter((level) => level.interceptors.length > 0));

				const getController = (() => {
					if (props.scope === HttpControllerScope.SERVER) {
						// Built once, on the first request, so that building the app needs no module to be
						// initialised.
						let controller: unknown;
						return () => () =>
							(controller ??= ModuleContext.run(node, () => Container.makeSingleton(target)));
					} else if (props.scope === HttpControllerScope.REQUEST) {
						return () => () => ModuleContext.run(node, () => Service.make(target));
					} else {
						throw new Error(`Invalid scope for controller: ${target.name}`);
					}
				})();

				app.derive('local', () => ({ controller: getController() }));

				/** Awaits what a request-scoped controller injects, so that it can be built synchronously. */
				const prepareController =
					props.scope === HttpControllerScope.REQUEST
						? () => ModuleContext.run(node, () => Container.prepareClass(target))
						: null;

				const onRequest = Metadata.get('http:onRequest', target) ?? {};
				if (onRequest.handler) {
					const callOnRequest = (c: Context) => {
						const controller = getController()();
						return ModuleContext.run(node, () => onRequest.handler.call(controller, c));
					};
					app.onRequest((c) =>
						Container.runInRequestScope(
							() =>
								prepareController
									? prepareController().then(() => callOnRequest(c as Context))
									: callOnRequest(c as Context),
							c.request
						)
					);
				}

				const middlewares = Metadata.get(Symbols.middlewares, target) ?? [];
				applyMiddlewares(middlewares, app, node);

				const metadata: HttpRequestHandlerMetadata[] = Metadata.get(Symbols.http, target) ?? [];

				for (const route of metadata) {
					/** The object the request scope of a request belongs to, shared by its hooks. */
					const scopeKey = (c: Context): object => c.request ?? c;

					const getParameters = (c: Context) =>
						Container.runInRequestScope(() => readParameters(c), scopeKey(c));

					const readParameters = async (c: Context) => {
						const parameters: any[] = [];

						if (prepareController) await prepareController();

						if (route.rawContext) {
							parameters[route.rawContext.index] = c;
						}

						if (route.body) {
							parameters[route.body.index] = c.body;
						}

						if (route.query) {
							parameters[route.query.index] = c.query;
						}

						if (!isEmpty(route.params)) {
							for (const param of route.params) {
								parameters[param.index] = c.params[param.slug];
							}
						}

						if (!isEmpty(route.customDecorators)) {
							for (const customDecorator of route.customDecorators) {
								parameters[customDecorator.index] = await ModuleContext.run(node, () =>
									customDecorator.handler(c)
								);
							}
						}

						if (!isEmpty(route.services)) {
							for (const service of route.services) {
								parameters[service.index] = await ModuleContext.run(node, () =>
									Container.resolveVisible(service.token)
								);
							}
						}

						return parameters;
					};

					const isGenerator = route.handler.constructor.name.includes('GeneratorFunction');
					const isSSE = route.method === 'elysium:SSE';
					const isTransactional = route.transactional ?? props.transactional ?? false;
					const isValidator =
						route.body && route.body.schema === undefined && route.body.validator !== undefined;

					route.method = isSSE ? 'GET' : route.method;

					const getHandler = () => {
						/**
						 * Runs `body` with the request entries in the application context, and in a database
						 * transaction for transactional routes.
						 */
						const inRequestScope = async <TResult>(
							c: Context,
							body: () => Promise<TResult>
						): Promise<TResult> =>
							Container.runInRequestScope(
								() =>
									Application.context.run(
										new Map([
											['tenant', c.tenant as unknown],
											['http:context', c]
										]),
										() => (isTransactional ? getTransactionRunner()(body) : body())
									),
								scopeKey(c)
							);

						const callHandler = <TResult>(c: Context, args: unknown[]): TResult =>
							ModuleContext.run(node, () => route.handler.call(c.controller(), ...args) as TResult);

						const initTransactedHandler = <TResult = unknown>(c: Context) => {
							return (...args: unknown[]) =>
								inRequestScope(c, async () => callHandler<Promise<TResult>>(c, args));
						};

						if (isGenerator) {
							return async function* (c: Context) {
								const params = await getParameters(c);

								try {
									yield* iterateInScope(
										(body) => inRequestScope(c, body),
										() => iterateInModule(node, callHandler<AsyncGenerator>(c, params)),
										c.request?.signal
									);
								} catch (error: any) {
									yield error;
								}
							};
						}

						if (isSSE) {
							return async function* (c: Context) {
								const handler = initTransactedHandler<SSEPayload>(c);

								c.set.headers['content-type'] = 'text/event-stream';
								c.set.headers['cache-control'] = 'no-cache';
								c.set.headers['connection'] = 'keep-alive';

								while (true) {
									yield esse(await handler(...(await getParameters(c))));
									await Runtime.get().sleep(10);
								}
							};
						}

						const routeInterceptors: InterceptorLevel = {
							interceptors: route.interceptors ?? [],
							node
						};

						/** Calls the handler through the interceptors of the app, module, controller and route. */
						const initInterceptedHandler = (c: Context) => {
							return (...args: unknown[]) =>
								inRequestScope(c, () =>
									runInterceptors(
										[...outerInterceptors(), routeInterceptors],
										c as unknown as InterceptorContext,
										async () => callHandler<Promise<unknown>>(c, args)
									)
								);
						};

						const successSchema =
							route.response && route.serialize !== false
								? Resource.successSchema(route.response)
								: undefined;

						/**
						 * Serializes a handler result through the route's response schema. A sparse
						 * fieldset leaves out required fields, so its body is sent as a response of its own,
						 * past the validation of the full schema.
						 */
						const toBody = (c: Context, result: unknown): unknown => {
							if (!successSchema || !isSerializable(result)) return result;
							const fields = readFields(c.query as Record<string, unknown>);
							const body = Resource.serialize(successSchema, result, { fields });
							if (!fields) return body;
							const status = typeof c.set.status === 'number' ? c.set.status : 200;
							return Response.json(body, { status });
						};

						if (isValidator) {
							return async function (c: Context) {
								if (await ModuleContext.run(node, () => route.body!.validator!.validate(c))) {
									const handler = initInterceptedHandler(c);
									return toBody(c, await handler(...(await getParameters(c))));
								}

								throw c.status(400, 'Invalid request body');
							};
						}

						return async function (c: Context) {
							const handler = initInterceptedHandler(c);
							return toBody(c, await handler(...(await getParameters(c))));
						};
					};

					const params = objectify(
						route.params ?? [],
						(p) => p.slug,
						(p) => p.schema
					);

					const mi = makeMiddlewares(route.middlewares, node);

					const routeName = `${route.method.toUpperCase()} ${joinPath(props.path, route.path)}`;
					/** The limit of the route, read on the first request: the app is created after it. */
					let limit: RateLimitOptions | false | undefined;
					const routeRateLimit = (): RateLimitOptions | false =>
						(limit ??= rateLimitOf(target, route.name) ?? appDefaultRateLimit() ?? false);

					const handler = getHandler();
					const filterLevels = [
						{ filters: route.filters ?? [], node },
						controllerFilters,
						moduleFilters
					].filter((level) => level.filters.length > 0);
					routeFilterLevels.set(handler, filterLevels);

					// The route is built from metadata at runtime, so Elysia cannot infer its types here.
					const addRoute = app.route as unknown as (
						method: string,
						path: string,
						hook: Record<string, unknown>,
						handler: unknown
					) => unknown;

					addRoute.call(
						app,
						route.method,
						route.path,
						{
							async transform(c: Context) {
								// Read by the error hook, which gets the same context object.
								(c as unknown as Record<symbol, unknown>)[FILTER_LEVELS] = filterLevels;
								if (
									isValidator &&
									!(await ModuleContext.run(node, () => route.body!.validator!.authorize(c)))
								) {
									throw c.status(401, 'Unauthorized');
								}

								return Container.runInRequestScope(
									() => executeMiddlewareChain(mi, c, 'onTransform', node),
									scopeKey(c)
								);
							},
							async beforeHandle(c: Context) {
								const limit = routeRateLimit();
								if (limit) {
									await enforceRateLimit(limit, appRateLimit()?.store, {
										request: c.request,
										ip: (c as unknown as { ip?: string }).ip,
										route: routeName,
										context: c as unknown as Record<string, unknown>,
										set: c.set as { headers: Record<string, string | number> }
									});
								}
								return Container.runInRequestScope(
									() => executeMiddlewareChain(mi, c, 'onBeforeHandle', node),
									scopeKey(c)
								);
							},
							afterHandle(c: Context) {
								return Container.runInRequestScope(
									() => executeMiddlewareChain(mi, c, 'onAfterHandle', node),
									scopeKey(c)
								);
							},
							afterResponse(c: Context) {
								return Container.runInRequestScope(
									() => executeMiddlewareChain(mi, c, 'onAfterResponse', node),
									scopeKey(c)
								);
							},
							detail: {
								tags: props.tags,
								description: route.description,
								operationId: route.operationId
							},
							body: isValidator ? route.body?.validator?.schema : route.body?.schema,
							response: route.response ? Resource.projectResponse(route.response) : undefined,
							params: isEmpty(params) ? undefined : t.Object(params)
						},
						handler
					);
				}

				return app;
			}

			Metadata.define('http:controller', props, target);
			Metadata.define(Symbols.elysiaPlugin, handleHttp, target);
		};
	};

	/**
	 * Marks a method as an HTTP "server-sent events" request handler.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param props The request handler properties.
	 */
	export const sse = (props: RequestHandlerDecoratorProps = {}): MethodDecorator => {
		const { path = '/', ...rest } = props;
		return custom({ method: 'elysium:SSE', path, ...rest });
	};

	/**
	 * Marks a method as an HTTP "get" request handler.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param props The request handler properties.
	 */
	export const get = (props: RequestHandlerDecoratorProps = {}): MethodDecorator => {
		const { path = '/', ...rest } = props;
		return custom({ method: 'GET', path, ...rest });
	};

	/**
	 * Marks a method as an HTTP "post" request handler.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param props The request handler properties.
	 */
	export const post = (props: RequestHandlerDecoratorProps = {}): MethodDecorator => {
		const { path = '/', ...rest } = props;
		return custom({ method: 'POST', path, ...rest });
	};

	/**
	 * Marks a method as an HTTP "put" request handler.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param props The request handler properties.
	 */
	export const put = (props: RequestHandlerDecoratorProps = {}): MethodDecorator => {
		const { path = '/', ...rest } = props;
		return custom({ method: 'PUT', path, ...rest });
	};

	/**
	 * Marks a method as an HTTP "delete" request handler.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param props The request handler properties.
	 */
	export const del = (props: RequestHandlerDecoratorProps = {}): MethodDecorator => {
		const { path = '/', ...rest } = props;
		return custom({ method: 'DELETE', path, ...rest });
	};

	/**
	 * Marks a method as an HTTP "patch" request handler.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param props The request handler properties.
	 */
	export const patch = (props: RequestHandlerDecoratorProps = {}): MethodDecorator => {
		const { path = '/', ...rest } = props;
		return custom({ method: 'PATCH', path, ...rest });
	};

	/**
	 * Marks a method as an HTTP "head" request handler.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param props The request handler properties.
	 */
	export const head = (props: RequestHandlerDecoratorProps = {}): MethodDecorator => {
		const { path = '/', ...rest } = props ?? {};
		return custom({ method: 'HEAD', path, ...rest });
	};

	/**
	 * Marks a method as an HTTP "options" request handler.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param props The request handler properties.
	 */
	export const options = (props: RequestHandlerDecoratorProps = {}): MethodDecorator => {
		const { path = '/', ...rest } = props;
		return custom({ method: 'OPTIONS', path, ...rest });
	};

	/**
	 * Marks a method as an HTTP "trace" request handler.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param props The request handler properties.
	 */
	export const trace = (props: RequestHandlerDecoratorProps = {}): MethodDecorator => {
		const { path = '/', ...rest } = props;
		return custom({ method: 'TRACE', path, ...rest });
	};

	/**
	 * Marks a method as an HTTP request handler with a custom method.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param props The request handler properties.
	 */
	export const custom = ({
		path = '/',
		...rest
	}: RequestHandlerDecoratorProps & { method: HTTPMethod }): MethodDecorator => {
		return function (target, propertyKey, descriptor) {
			queueMicrotask(() => {
				registerHttpRequestHandler({
					path,
					handler: descriptor.value as HttpRequestHandler,
					target,
					propertyKey,
					...rest
				});
			});
		};
	};

	/**
	 * Marks a method as the callback for the request handler.
	 * @author Axel Nana <axel.nana@workbud.com>
	 */
	export const onRequest = (): MethodDecorator => {
		return function (target, _, descriptor) {
			const metadata = Metadata.get('http:onRequest', target.constructor) ?? {};
			metadata.handler = descriptor.value;
			Metadata.define('http:onRequest', metadata, target.constructor);
		};
	};

	/**
	 * Resolves the context for the current request in the annotated parameter.
	 * @author Axel Nana <axel.nana@workbud.com>
	 */
	export const context = (): ParameterDecorator => {
		return function (target, propertyKey, parameterIndex) {
			Metadata.define('http:rawContext', { index: parameterIndex }, target, propertyKey!);
		};
	};

	/**
	 * Resolves the value of a URL parameter in the annotated parameter.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param slug The slug of the parameter.
	 * @param schema The schema of the parameter.
	 */
	export const param = (slug: string, schema?: TSchema): ParameterDecorator => {
		return function (target, propertyKey, parameterIndex) {
			const params = Metadata.get('http:params', target, propertyKey!) ?? [];
			params.push({ slug, schema: schema ?? t.String(), index: parameterIndex });
			Metadata.define('http:params', params, target, propertyKey!);
		};
	};

	/**
	 * Resolves the value of a query parameter in the annotated parameter.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param schema The schema of the query parameter.
	 */
	export const query = (schema?: TSchema): ParameterDecorator => {
		return function (target, propertyKey, parameterIndex) {
			Metadata.define('http:query', { schema, index: parameterIndex }, target, propertyKey!);
		};
	};

	/**
	 * Resolves the value of the request body in the annotated parameter.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param schema The schema of the request body.
	 */
	export const body = (schema?: TSchema | ValidatorClass): ParameterDecorator => {
		return function (target, propertyKey, parameterIndex) {
			if (typeof schema === 'function') {
				Metadata.define(
					'http:body',
					{ validator: schema, index: parameterIndex },
					target,
					propertyKey!
				);
			} else {
				Metadata.define('http:body', { schema, index: parameterIndex }, target, propertyKey!);
			}
		};
	};

	/**
	 * Executes a custom function to resolve the value of the parameter from the context.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param handler The custom function that will return the value for the parameter.
	 */
	export const decorate = (handler: Handler): (() => ParameterDecorator) => {
		return () => {
			return function (target, propertyKey, parameterIndex) {
				const decorators = Metadata.get('http:customDecorators', target, propertyKey!) ?? [];
				decorators.push({ handler, index: parameterIndex });
				Metadata.define('http:customDecorators', decorators, target, propertyKey!);
			};
		};
	};
}
