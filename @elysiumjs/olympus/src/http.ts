// Copyright (c) 2025-present Axel Nana <ax.lnana@outlook.com>. All rights reserved.
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
import type { Static, TObject, TSchema } from 'typebox';
import type { AppHttpContext } from '.';
import type { Environment } from './environments';
import type { FilterClass, FilterLevel } from './filter';
import type { InterceptorClass, InterceptorContext, InterceptorLevel } from './interceptor';
import type { Middleware } from './middleware';
import type { Module } from './module';
import type { ModuleNode } from './module-graph';
import type { ProblemClass } from './problem';
import type { AppRateLimitOptions, RateLimitOptions } from './rate-limit';
import type { ResponseSchemas } from './resource';
import type { Injection } from './token';
import type { ViewClass, ViewKind, ViewPagination, ViewResponse } from './view';

import { Elysia, ElysiaStatus, sse as esse, t } from 'elysia';
import { assign, isEmpty, objectify } from 'radash';

import { Application } from './app';
import { Container } from './container';
import { Environments } from './environments';
import { ElysiumError } from './errors';
import { FILTER_LEVELS, routeFilterLevels } from './filter';
import { interceptedSchema, runInterceptors } from './interceptor';
import { Lifecycle } from './lifecycle';
import { Metadata } from './metadata';
import { applyMiddlewares, enlist, executeMiddlewareChain, makeMiddlewares } from './middleware';
import { ModuleContext } from './module-context';
import { BadRequestError, DomainError, InternalError, validationProblemSchema } from './problem';
import { enforceRateLimit, rateLimitOf, TooManyRequestsError } from './rate-limit';
import { isSerializable, isStatusMap, readFields, Resource, toJsonForm } from './resource';
import { Result } from './result';
import { Runtime } from './runtime';
import { PayloadTooLargeError } from './security';
import { Service } from './service';
import { nextTick, Symbols } from './utils';
import { ViewNotRenderableError, Views } from './view';

/**
 * A route is a string that starts with a forward slash.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type Route = `/${string}`;

/**
 * An HTTP method name.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type HTTPMethod = string;

/**
 * A function computing a value from the request context, used by custom parameter decorators.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
type Handler = (c: Context) => unknown;

/**
 * A class for validating data against a schema.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type ValidatorClass<T extends TSchema = TSchema> = {
	/** The problems the validator answers with besides failed validation, for the OpenAPI document. */
	readonly errors?: readonly ProblemClass[];

	/**
	 * The validation schema. This schema is automatically checked against the input data during
	 * the validation stage of the HTTP request.
	 */
	readonly schema: T;

	/**
	 * Whether the request should be authorized before validation. If the request is not authorized,
	 * the validation will be skipped. Optional: without it, every request goes on to validation.
	 * @returns `true` to go on, `false` to answer 401, or the `DomainError` to answer instead.
	 */
	authorize?(ctx: Context<Static<T>>): Promise<boolean | DomainError>;

	/**
	 * Processes custom validation logic. This method is called after the validation schema is checked
	 * against the input data. So it's safe to assume that the schema is valid. Optional: without it,
	 * the schema alone decides.
	 * @param ctx The request context, with the input data as its body.
	 * @returns `true` when the input data is valid, `false` to answer a generic 400, or the
	 * `DomainError` to answer instead, with its own status, code and extensions.
	 */
	validate?(ctx: Context<Static<T>>): Promise<boolean | DomainError>;
};

/**
 * A function that handles an HTTP request.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
type HttpRequestHandler = <TResult = unknown, TArgs extends any[] = unknown[]>(
	...args: TArgs
) => Promise<TResult>;

/**
 * Stores metadata for an HTTP request handler.
 * @author Axel Nana <ax.lnana@outlook.com>
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
	 * The view that renders the handler's result, whether it renders one item, a list or a page,
	 * and the pagination of a page, when the route's query gives one.
	 */
	view?: { view: ViewClass; kind: ViewKind; pagination?: ViewPagination };

	/** The status of a successful response. */
	status?: number;

	/**
	 * The problems the route answers with.
	 */
	errors?: readonly ProblemClass[];

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
	 * The request headers the handler reads, by lowercase name.
	 */
	headerParams?: Array<{ name: string; schema: TSchema; index: number }>;

	/**
	 * The request headers the route declares, from its `headers` option.
	 */
	headers?: TObject;

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
	services: Injection[];

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

	/** How the request body is parsed before the handler runs. */
	parse?: HttpBodyParser;
};

/**
 * How a route parses the request body before its handler runs. `none` leaves the body unread, so
 * the handler reads the request itself (a webhook checking a signature over the exact bytes).
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type HttpBodyParser = 'none' | 'text' | 'json' | 'formdata' | 'urlencoded' | 'arrayBuffer';

/**
 * Parameters for registering an HTTP request handler.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
type HttpRequestHandlerRegistrationProps = Pick<
	HttpRequestHandlerMetadata,
	| 'path'
	| 'method'
	| 'handler'
	| 'errors'
	| 'operationId'
	| 'description'
	| 'transactional'
	| 'serialize'
	| 'filters'
	| 'interceptors'
	| 'headers'
	| 'parse'
	| 'status'
> & {
	response?: TSchema | Record<number, TSchema> | ViewClass | ViewResponse;
	target: Object;
	propertyKey: string | symbol;
};

/**
 * Metadata for the HTTP context.
 * @author Axel Nana <ax.lnana@outlook.com>
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
 * @author Axel Nana <ax.lnana@outlook.com>
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
				generator.return(undefined).catch((error) => Lifecycle.emit('elysium:error', error));
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
 * @author Axel Nana <ax.lnana@outlook.com>
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

/**
 * The headers schema of a route: the headers of its `headers` option and those its handler
 * reads with `@Http.header()`. Other headers are let through.
 */
const headersSchema = (route: HttpRequestHandlerMetadata): TObject | undefined => {
	const properties: Record<string, TSchema> = {};
	for (const [name, schema] of Object.entries(route.headers?.properties ?? {})) {
		properties[name.toLowerCase()] = schema as TSchema;
	}
	for (const header of route.headerParams ?? []) properties[header.name] = header.schema;
	return isEmpty(properties) ? undefined : t.Object(properties, { additionalProperties: true });
};

/**
 * Checks a route that answers with a view, as it is declared: the view renders, and the route
 * neither sends events nor skips serialization.
 */
const checkViewRoute = (
	method: string,
	options: HttpRouteOptions,
	target: Object,
	propertyKey: string | symbol
) => {
	const named = Views.of(options.response);
	if (!named) return;
	const route = `${target.constructor.name}.${String(propertyKey)}`;
	if (!Views.isRenderable(named.view)) throw new ViewNotRenderableError(named.view.name);
	if (method === 'elysium:SSE') {
		throw new ElysiumError(`The route ${route} sends events: it cannot answer with a view.`);
	}
	if (options.serialize === false) {
		throw new ElysiumError(
			`The route ${route} answers with a view: its result is always serialized.`
		);
	}
};

const registerHttpRequestHandler = (props: HttpRequestHandlerRegistrationProps) => {
	const body = Metadata.get('http:body', props.target, props.propertyKey);
	const params = Metadata.get('http:params', props.target, props.propertyKey) ?? [];
	const query = Metadata.get('http:query', props.target, props.propertyKey);
	const headerParams = Metadata.get('http:headers', props.target, props.propertyKey);
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
		errors,
		operationId,
		description,
		transactional,
		serialize,
		filters,
		interceptors,
		headers,
		parse,
		status
	} = props;

	const metadata: HttpRequestHandlerMetadata[] =
		Metadata.get(Symbols.http, target.constructor) ?? [];

	// A view in `response` renders the result; the response schema is the view's.
	const named = Views.of(response);
	const view = named && {
		...named,
		...(named.kind === 'page' ? { pagination: Views.paginationOf(query?.schema) } : {})
	};
	const responseSchema = view
		? Views.schemaOf(view.view, view.kind, view.pagination)
		: (response as TSchema | Record<number, TSchema> | undefined);

	metadata.push({
		name: String(props.propertyKey),
		path,
		method,
		body,
		params,
		query,
		headerParams,
		headers,
		customDecorators,
		rawContext,
		handler,
		middlewares,
		response: responseSchema,
		view,
		errors,
		operationId,
		description,
		services,
		transactional,
		serialize,
		filters,
		interceptors,
		parse,
		status
	});

	Metadata.define(Symbols.http, metadata, target.constructor);
};

/**
 * The scope of an HTTP controller.
 * @author Axel Nana <ax.lnana@outlook.com>
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
 * Options of `@Http.controller()`.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type HttpControllerOptions = {
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
	/**
	 * The environments (`NODE_ENV` values) in which the controller is active. In any other, its
	 * routes are not mounted.
	 */
	env?: readonly Environment[];
};

/**
 * What an HTTP controller records: its path and its options.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type HttpControllerProps = HttpControllerOptions & {
	/** The path of the controller. */
	path: Route;
};

/**
 * Options of the route decorators, such as `@Http.get()`.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type HttpRouteOptions = {
	/**
	 * The schema of the response body: the handler's result, or one schema per status. Interceptors
	 * that change the shape of results (see `TransformInterceptor.with()`) give the schema of what
	 * the client receives from it.
	 *
	 * A view renders the handler's result first: `PostView` renders one item, `PostView.list` a
	 * list and `PostView.page` a page (see `View`), and the response schema is the view's.
	 * @example
	 * ```ts
	 * @Http.get('/:id', { response: PostView })
	 * @Http.get('/', { response: PostView.page })
	 * ```
	 */
	response?: TSchema | Record<number, TSchema> | ViewClass | ViewResponse;

	/**
	 * The status of a successful response, such as `201` for a creation or `204` for a route that
	 * answers without a body. Defaults to `200`. A single `response` schema is documented under it,
	 * and a `204` route sends no body whatever the handler returns. A handler that sets
	 * `ctx.set.status` itself keeps its own.
	 * @example
	 * ```ts
	 * @Http.post('/', { status: 201, response: Wallet })
	 * @Http.del('/:id', { status: 204 })
	 * ```
	 */
	status?: number;

	/**
	 * The problems the route answers with, by their classes (made with `DomainError.for()`). They
	 * are documented under their status, next to the problems of the framework: validation (422),
	 * malformed requests (400), bodies over the limit (413), rate limits (429), server errors (500),
	 * and those that the route's middlewares, interceptors and validator list in their own `errors`.
	 * @example
	 * ```ts
	 * @Http.post('/', { response: Receipt, errors: [InsufficientFunds, ...TopUp.errors] })
	 * ```
	 */
	errors?: readonly ProblemClass[];

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

	/**
	 * The request headers of the route, validated before the handler runs and documented in
	 * OpenAPI. Header names are lowercase. A request whose headers do not match gets a 400
	 * `BAD_REQUEST` problem. `@Http.header()` adds the headers it reads to these.
	 * @example
	 * ```ts
	 * @Http.post('/', { headers: t.Object({ 'x-flow-key': t.String() }) })
	 * ```
	 */
	headers?: TObject;

	/**
	 * How the request body is parsed before the handler runs. By default it follows the request's
	 * `Content-Type`. `none` leaves the body unread for the handler, which reads it from the request,
	 * such as to check a signature over the exact bytes. It cannot be combined with `@Http.body()`.
	 * @example
	 * ```ts
	 * @Http.post('/webhooks/:provider', { parse: 'none' })
	 * public async receive(@Http.context() ctx: Context) {
	 * 	const raw = await ctx.request.text();
	 * }
	 * ```
	 */
	parse?: HttpBodyParser;
};

/**
 * What a route decorator records: its method, its path and its options.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type RequestHandlerDecoratorProps = HttpRouteOptions & {
	/** The HTTP method of the handler. */
	method?: HTTPMethod;
	/** The path of the route, relative to the controller path. */
	path?: Route;
};

/**
 * A route of an HTTP controller, as `Http.describe()` reports it.
 * @author Axel Nana <ax.lnana@outlook.com>
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
	/** The success status of the route, when it sets one. */
	status?: number;
	/** Whether the route declares the schema of its success response. */
	responds: boolean;
	/**
	 * The view that renders the route's result, when its `response` names one, with the pagination
	 * of a page when the route's query gives one.
	 */
	view?: { view: ViewClass; kind: ViewKind; pagination?: ViewPagination };
};

/**
 * An HTTP controller, as `Http.describe()` reports it.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type HttpControllerDescription = {
	/** The path of the controller. */
	path: Route;
	/** The routes of the controller. */
	routes: HttpRouteDescription[];
};

/**
 * The types of a route in the generated route types, as TypeScript type text. A part left out
 * keeps the type the route type generator reads from the controller method.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type HttpRouteTypes = {
	/** The type of the URL parameters, an object type such as `{ id: string }`. */
	params?: string;
	/** The type of the query. */
	query?: string;
	/** The type of the request body. */
	body?: string;
	/** The type of the response. */
	response?: string;
	/** The named type imports the type text needs. */
	imports?: Array<{ from: string; names: string[] }>;
};

/**
 * How the generated route types can refer to a controller method. Both are `undefined` when the
 * controller class cannot be imported (it is not exported by a file of the project), and then
 * the contributor gives every type of the route.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type HttpRouteTypeRef = {
	/** The method type, such as `SignUpFlow['email']`. */
	method?: string;
	/** The type of a method parameter, such as `Parameters<SignUpFlow['email']>[1]`. */
	parameter?: (index: number) => string;
};

/**
 * Types the routes of the controllers it supports in the generated route types, when the
 * controller method signature does not give them, such as routes a decorator adds. Register it
 * with the {@link Http.RouteTypes} tag.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export interface HttpRouteTypesContributor {
	/** Whether it types routes of `controller`. */
	supports(controller: Function): boolean;
	/**
	 * The types of a route of `controller`, or `undefined` to keep the types read from the method.
	 * @param controller The controller class.
	 * @param route The route, as `Http.describe()` reports it.
	 * @param ref How to refer to the method in type text.
	 */
	route(
		controller: Function,
		route: HttpRouteDescription,
		ref: HttpRouteTypeRef
	): HttpRouteTypes | undefined;
}

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

/** The options of the running application that decide the problems of every route. */
const appProblemOptions = (): { validationStatus: number; bodyLimit: boolean } => {
	const app = Service.get<object>('elysium.app');
	const props = app ? Metadata.get(Symbols.app, app.constructor) : undefined;
	return {
		validationStatus: props?.problems?.validationStatus ?? ValidationStatus,
		bodyLimit: props?.http?.bodyLimit !== false
	};
};

/** The status of validation problems when the application sets none. */
const ValidationStatus = 422;

/** The problems a class lists in its static `errors`: a middleware, an interceptor or a validator. */
const declaredErrors = (cls: unknown): readonly ProblemClass[] =>
	(cls as { errors?: readonly ProblemClass[] } | undefined)?.errors ?? [];

/** What decides the problems of a route besides those it lists. */
type RouteProblems = {
	/** The problems the route lists, then those of its middlewares, interceptors and validator. */
	declared: readonly ProblemClass[];
	/** Whether the body or the query is validated. */
	validated: boolean;
	/** Whether a request can be refused as malformed: a body to parse, or declared headers. */
	malformed: boolean;
	/** Whether the route reads a body, which the body limit applies to. */
	body: boolean;
	/** Whether the route has a rate limit. */
	rateLimited: boolean;
};

/**
 * The response schemas of a route, by status: the success schemas as the interceptors make them,
 * and the problems of the route and of the framework. Several problems of one status make a union.
 */
const routeResponses = (
	response: ResponseSchemas | undefined,
	levels: InterceptorLevel[],
	problems: RouteProblems,
	success = 200
): Record<number, TSchema> => {
	const responses: Record<number, TSchema> = {};
	const declared =
		response === undefined ? {} : isStatusMap(response) ? response : { [success]: response };
	for (const [key, schema] of Object.entries(declared)) {
		const status = Number(key);
		responses[status] = status >= 200 && status < 300 ? interceptedSchema(levels, schema) : schema;
	}

	const { validationStatus, bodyLimit } = appProblemOptions();
	const errors: Array<{ status: number; code: string; schema: TSchema }> = problems.declared.map(
		(problem) => ({ status: problem.status, code: problem.code, schema: problem.schema })
	);
	if (problems.validated) {
		errors.push({
			status: validationStatus,
			code: ValidationFailedCode,
			schema: validationProblemSchema(validationStatus)
		});
	}
	const framework: ProblemClass[] = [
		...(problems.malformed ? [BadRequestError] : []),
		...(problems.body && bodyLimit ? [PayloadTooLargeError] : []),
		...(problems.rateLimited ? [TooManyRequestsError] : []),
		InternalError
	];
	for (const problem of framework) {
		errors.push({ status: problem.status, code: problem.code, schema: problem.schema });
	}

	const byStatus = new Map<number, Map<string, TSchema>>();
	for (const { status, code, schema } of errors) {
		// A schema the route gives for a status wins over the problems of that status.
		if (status in declared) continue;
		let codes = byStatus.get(status);
		if (!codes) byStatus.set(status, (codes = new Map()));
		if (!codes.has(code)) codes.set(code, schema);
	}
	for (const [status, codes] of [...byStatus].sort(([a], [b]) => a - b)) {
		const schemas = [...codes.values()];
		responses[status] = schemas.length === 1 ? schemas[0]! : t.Union(schemas);
	}
	return responses;
};

/** The code of validation problems. */
const ValidationFailedCode = 'VALIDATION_FAILED';

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

/** Whether a route response declares a success (2xx) schema. */
const declaresSuccess = (response: ResponseSchemas | undefined): boolean => {
	if (response === undefined) return false;
	if (!isStatusMap(response)) return true;
	return Object.keys(response).some((status) => Number(status) >= 200 && Number(status) < 300);
};

export namespace Http {
	/**
	 * The tag of the route types contributors, read by `styx routes:generate`. Register a
	 * contributor as a global service active in development only:
	 * @author Axel Nana <ax.lnana@outlook.com>
	 * @example
	 * ```ts
	 * @Service.register({ tags: [Http.RouteTypes], global: true, env: Environments.local })
	 * export class FlowRouteTypes implements HttpRouteTypesContributor {
	 * 	public supports(controller: Function) {
	 * 		return Flow.describe(controller) !== undefined;
	 * 	}
	 *
	 * 	public route(controller: Function, route: HttpRouteDescription) {
	 * 		return route.name === 'ariadne:start'
	 * 			? { response: 'FlowStart', imports: [{ from: '@elysiumjs/olympus/ariadne', names: ['FlowStart'] }] }
	 * 			: undefined;
	 * 	}
	 * }
	 * ```
	 */
	export const RouteTypes = Service.tag<HttpRouteTypesContributor>('http.route-types');

	/**
	 * The context of the HTTP request being handled, for code outside the handler such as a
	 * service or a repository: its request, its `set`, and what middlewares put in it (such as
	 * `currentUser`). `undefined` outside a request.
	 * @author Axel Nana <ax.lnana@outlook.com>
	 * @example
	 * ```ts
	 * const ip = Http.currentContext()?.request.headers.get('cf-connecting-ip');
	 * ```
	 */
	export const currentContext = <TContext extends object = Context>(): TContext | undefined =>
		Application.context.getStore()?.get('http:context') as TContext | undefined;

	/**
	 * Describes the routes of an HTTP controller, for tools such as the route type generator.
	 * Route decorators register their routes on the next tick, so call it after importing the
	 * controller and awaiting a tick.
	 * @author Axel Nana <ax.lnana@outlook.com>
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
					params: route.params.map(({ slug, index }) => ({ slug, index })),
					status: route.status,
					responds: declaresSuccess(route.response),
					...(route.view ? { view: { ...route.view } } : {})
				};
			})
		};
	};

	/**
	 * Marks a class as an HTTP controller.
	 * @author Axel Nana <ax.lnana@outlook.com>
	 * @param path The path of the controller. Defaults to `/`.
	 * @param options The options of the controller.
	 * @example
	 * ```ts
	 * @Http.controller('/wallets', { tags: ['wallets'] })
	 * class WalletController {}
	 * ```
	 */
	export const controller = (path: Route = '/', options: HttpControllerOptions = {}) => {
		let props: HttpControllerProps = { ...options, path };
		return function (target: Class<any>) {
			Environments.set(target, options.env);
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
					if (route.parse === 'none' && route.body)
						throw new ElysiumError(
							`${target.name}.${route.name}: a route that does not parse its body cannot take @Http.body()`
						);

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

						for (const header of route.headerParams ?? []) {
							parameters[header.index] = c.headers[header.name];
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
									Container.resolveInjection(service)
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

						/**
						 * Calls the handler, and throws the DomainError it returns: a returned error rolls back
						 * the transaction and reaches the interceptors and the error hooks like a thrown one. A
						 * returned `Result` answers its value, or throws its error.
						 */
						const callForValue = async <TResult>(c: Context, args: unknown[]): Promise<TResult> => {
							const returned = await callHandler<Promise<unknown>>(c, args);
							const result = Result.is(returned) ? returned.orThrow() : returned;
							if (result instanceof DomainError) throw result;
							if (route.view && result != null) {
								const { view, kind, pagination } = route.view;
								const json = Views.rendersJson(view);
								if (isSerializable(result)) {
									if (!json) c.set.headers['content-type'] ??= view.contentType;
									return Views.render(view, kind, result, pagination) as TResult;
								}
								// A status the handler set, such as `c.status(201, post)`: its body is rendered
								// by the view, and keeps its status and headers.
								if (result instanceof ElysiaStatus && result.response != null) {
									const rendered = Views.render(view, kind, result.response, pagination);
									const body = json
										? Resource.serialize(Views.schemaOf(view, kind, pagination), rendered)
										: rendered;
									const headers = json
										? result.headers
										: { 'content-type': view.contentType, ...result.headers };
									return new ElysiaStatus(result.status, body, headers) as TResult;
								}
							}
							return result as TResult;
						};

						const initTransactedHandler = <TResult = unknown>(c: Context) => {
							return (...args: unknown[]) =>
								inRequestScope(c, () => callForValue<TResult>(c, args));
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
										() => callForValue<unknown>(c, args)
									)
								);
						};

						const successSchema =
							route.response && route.serialize !== false
								? Resource.successSchema(responses)
								: undefined;

						/**
						 * Serializes a handler result through the route's response schema. A sparse
						 * fieldset leaves out required fields, so its body is sent as a response of its own,
						 * past the validation of the full schema.
						 */
						const toBody = (c: Context, result: unknown): unknown => {
							if (!isSerializable(result)) return result;
							// A view that renders another media type, such as HTML, sends what it rendered.
							if (route.view && !Views.rendersJson(route.view.view)) return result;
							if (!successSchema) return toJsonForm(result);
							const fields = readFields(c.query as Record<string, unknown>);
							const body = Resource.serialize(successSchema, result, { fields });
							if (!fields) return body;
							const status = typeof c.set.status === 'number' ? c.set.status : 200;
							return Response.json(body, { status });
						};

						/**
						 * Answers a successful call: with the route's `status`, unless the handler set its own,
						 * and without a body for a 204.
						 */
						const answer = async (c: Context): Promise<unknown> => {
							const before = c.set.status;
							const handler = initInterceptedHandler(c);
							const result = await handler(...(await getParameters(c)));
							if (route.status !== undefined && c.set.status === before)
								c.set.status = route.status;
							if (c.set.status === 204) return undefined;
							return toBody(c, result);
						};

						const validator = route.body?.validator;
						if (isValidator && validator?.validate) {
							return async function (c: Context) {
								const valid = await ModuleContext.run(node, () => validator.validate!(c));
								if (valid instanceof DomainError) throw valid;
								if (!valid) throw new BadRequestError('The request body is invalid.');

								return answer(c);
							};
						}

						return async function (c: Context) {
							return answer(c);
						};
					};

					const params = objectify(
						route.params ?? [],
						(p) => p.slug,
						(p) => p.schema
					);

					const headers = headersSchema(route);

					const appMiddlewares = (() => {
						const app = Service.get<object>('elysium.app');
						return app ? (Metadata.get(Symbols.middlewares, app.constructor) ?? []) : [];
					})();
					const interceptorLevels = [
						appInterceptorLevel(),
						moduleInterceptorLevel(node),
						{ interceptors: props.interceptors ?? [], node },
						{ interceptors: route.interceptors ?? [], node }
					];
					const responses = routeResponses(
						route.response,
						interceptorLevels,
						{
							declared: [
								...(route.errors ?? []),
								...[
									...route.middlewares,
									...middlewares,
									...(Metadata.get(Symbols.middlewares, node.moduleClass) ?? []),
									...appMiddlewares
								].flatMap(declaredErrors),
								...interceptorLevels.flatMap((level) => level.interceptors).flatMap(declaredErrors),
								...declaredErrors(route.body?.validator)
							],
							validated: Boolean(route.body || route.query),
							malformed: Boolean(route.body || headers),
							body: Boolean(route.body),
							rateLimited: Boolean(rateLimitOf(target, route.name) ?? appDefaultRateLimit())
						},
						route.status
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
								const validator = route.body?.validator;
								if (isValidator && validator?.authorize) {
									const authorized = await ModuleContext.run(node, () => validator.authorize!(c));
									if (authorized instanceof DomainError) throw authorized;
									if (!authorized) throw c.status(401, 'Unauthorized');
								}

								return Container.runInRequestScope(
									() => executeMiddlewareChain(mi, c, 'onTransform', node),
									scopeKey(c)
								);
							},
							async beforeHandle(c: Context) {
								enlist(c, mi, node);
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
								operationId: route.operationId,
								// The media type of a view that does not render JSON, for the OpenAPI document.
								...(route.view && !Views.rendersJson(route.view.view)
									? { [Views.MEDIA_TYPE_KEYWORD]: route.view.view.contentType }
									: {})
							},
							...(route.parse && { parse: route.parse }),
							body: isValidator ? route.body?.validator?.schema : route.body?.schema,
							query: route.query?.schema,
							headers,
							response: Resource.projectResponse(responses),
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
	 * @author Axel Nana <ax.lnana@outlook.com>
	 * @param path The path of the route, relative to the controller path. Defaults to `/`.
	 * @param options The options of the route.
	 */
	export const sse = (path: Route = '/', options: HttpRouteOptions = {}): MethodDecorator =>
		custom('elysium:SSE', path, options);

	/**
	 * Marks a method as an HTTP "get" request handler.
	 * @author Axel Nana <ax.lnana@outlook.com>
	 * @param path The path of the route, relative to the controller path. Defaults to `/`.
	 * @param options The options of the route.
	 * @example
	 * ```ts
	 * @Http.get('/:id', { response: WalletSchema })
	 * public show(@Http.param('id') id: string) {}
	 * ```
	 */
	export const get = (path: Route = '/', options: HttpRouteOptions = {}): MethodDecorator =>
		custom('GET', path, options);

	/**
	 * Marks a method as an HTTP "post" request handler.
	 * @author Axel Nana <ax.lnana@outlook.com>
	 * @param path The path of the route, relative to the controller path. Defaults to `/`.
	 * @param options The options of the route.
	 */
	export const post = (path: Route = '/', options: HttpRouteOptions = {}): MethodDecorator =>
		custom('POST', path, options);

	/**
	 * Marks a method as an HTTP "put" request handler.
	 * @author Axel Nana <ax.lnana@outlook.com>
	 * @param path The path of the route, relative to the controller path. Defaults to `/`.
	 * @param options The options of the route.
	 */
	export const put = (path: Route = '/', options: HttpRouteOptions = {}): MethodDecorator =>
		custom('PUT', path, options);

	/**
	 * Marks a method as an HTTP "delete" request handler.
	 * @author Axel Nana <ax.lnana@outlook.com>
	 * @param path The path of the route, relative to the controller path. Defaults to `/`.
	 * @param options The options of the route.
	 */
	export const del = (path: Route = '/', options: HttpRouteOptions = {}): MethodDecorator =>
		custom('DELETE', path, options);

	/**
	 * Marks a method as an HTTP "patch" request handler.
	 * @author Axel Nana <ax.lnana@outlook.com>
	 * @param path The path of the route, relative to the controller path. Defaults to `/`.
	 * @param options The options of the route.
	 */
	export const patch = (path: Route = '/', options: HttpRouteOptions = {}): MethodDecorator =>
		custom('PATCH', path, options);

	/**
	 * Marks a method as an HTTP "head" request handler.
	 * @author Axel Nana <ax.lnana@outlook.com>
	 * @param path The path of the route, relative to the controller path. Defaults to `/`.
	 * @param options The options of the route.
	 */
	export const head = (path: Route = '/', options: HttpRouteOptions = {}): MethodDecorator =>
		custom('HEAD', path, options);

	/**
	 * Marks a method as an HTTP "options" request handler.
	 * @author Axel Nana <ax.lnana@outlook.com>
	 * @param path The path of the route, relative to the controller path. Defaults to `/`.
	 * @param options The options of the route.
	 */
	export const options = (path: Route = '/', options: HttpRouteOptions = {}): MethodDecorator =>
		custom('OPTIONS', path, options);

	/**
	 * Marks a method as an HTTP "trace" request handler.
	 * @author Axel Nana <ax.lnana@outlook.com>
	 * @param path The path of the route, relative to the controller path. Defaults to `/`.
	 * @param options The options of the route.
	 */
	export const trace = (path: Route = '/', options: HttpRouteOptions = {}): MethodDecorator =>
		custom('TRACE', path, options);

	/**
	 * Marks a method as an HTTP request handler with a custom method.
	 * @author Axel Nana <ax.lnana@outlook.com>
	 * @param method The HTTP method.
	 * @param path The path of the route, relative to the controller path. Defaults to `/`.
	 * @param options The options of the route.
	 */
	export const custom = (
		method: HTTPMethod,
		path: Route = '/',
		options: HttpRouteOptions = {}
	): MethodDecorator => {
		return function (target, propertyKey, descriptor) {
			checkViewRoute(method, options, target, propertyKey);
			queueMicrotask(() => {
				registerHttpRequestHandler({
					method,
					path,
					handler: descriptor.value as HttpRequestHandler,
					target,
					propertyKey,
					...options
				});
			});
		};
	};

	/**
	 * Marks a method as the callback for the request handler.
	 * @author Axel Nana <ax.lnana@outlook.com>
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
	 * @author Axel Nana <ax.lnana@outlook.com>
	 */
	export const context = (): ParameterDecorator => {
		return function (target, propertyKey, parameterIndex) {
			Metadata.define('http:rawContext', { index: parameterIndex }, target, propertyKey!);
		};
	};

	/**
	 * Resolves the value of a URL parameter in the annotated parameter.
	 * @author Axel Nana <ax.lnana@outlook.com>
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
	 * Resolves the value of a request header in the annotated parameter. The header is validated
	 * with the route's other headers (a 400 `BAD_REQUEST` problem when it does not match) and
	 * documented in OpenAPI.
	 * @author Axel Nana <ax.lnana@outlook.com>
	 * @param name The name of the header, in any case.
	 * @param schema The schema of the header. Defaults to a required string; wrap it in
	 * `t.Optional()` for a header the request may leave out.
	 * @example
	 * ```ts
	 * @Http.get('/')
	 * public list(@Http.header('x-tenant-id') tenant: string) {}
	 * ```
	 */
	export const header = (name: string, schema?: TSchema): ParameterDecorator => {
		return function (target, propertyKey, parameterIndex) {
			const headers = Metadata.get('http:headers', target, propertyKey!) ?? [];
			headers.push({
				name: name.toLowerCase(),
				schema: schema ?? t.String(),
				index: parameterIndex
			});
			Metadata.define('http:headers', headers, target, propertyKey!);
		};
	};

	/**
	 * Resolves the value of a query parameter in the annotated parameter.
	 * @author Axel Nana <ax.lnana@outlook.com>
	 * @param schema The schema of the query parameter.
	 */
	export const query = (schema?: TSchema): ParameterDecorator => {
		return function (target, propertyKey, parameterIndex) {
			Metadata.define('http:query', { schema, index: parameterIndex }, target, propertyKey!);
		};
	};

	/**
	 * Resolves the value of the request body in the annotated parameter.
	 * @author Axel Nana <ax.lnana@outlook.com>
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
	 * @author Axel Nana <ax.lnana@outlook.com>
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
