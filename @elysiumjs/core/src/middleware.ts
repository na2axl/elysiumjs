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

import type { AnyElysia } from 'elysia';
import type { Class } from 'type-fest';
import type { Context } from './http';
import type { LoggerInterface } from './logger';
import type { ModuleNode } from './module-graph';

import { Application } from './app';
import { getLogger } from './logger';
import { Metadata } from './metadata';
import { ModuleContext } from './module-context';
import { Service } from './service';
import { Symbols } from './utils';

/**
 * Execute a chain of middlewares, stopping on the first return or throw.
 * @author Axel Nana <axel.nana@workbud.com>
 * @param middlewares The list of middleware instances to execute.
 * @param context The context to pass to each middleware.
 * @param method The method to call on each middleware.
 * @param node The module the middlewares belong to. The chain runs in its context.
 */
export const executeMiddlewareChain = (
	middlewares: Middleware[],
	context: any,
	method: Exclude<keyof Middleware, 'guards'>,
	node: ModuleNode | null = null
): Promise<any> => {
	const chain = async () => {
		for (const middleware of middlewares) {
			const result = await middleware[method](context);
			if (result !== undefined) {
				return result; // Stop the chain if middleware returns a value
			}
		}
	};

	return Application.context.run(
		new Map([
			['tenant', context.tenant],
			['http:context', context]
		]),
		() => (node ? ModuleContext.run(node, chain) : chain())
	);
};

/**
 * Builds middleware instances in the context of a module.
 * @author Axel Nana <axel.nana@workbud.com>
 * @param middlewares The middleware classes.
 * @param node The owning module, or `null` to build them with global visibility only.
 */
export const makeMiddlewares = (
	middlewares: Class<Middleware>[],
	node: ModuleNode | null
): Middleware[] => {
	return middlewares.map((middleware) =>
		node
			? ModuleContext.run(node, () => Service.make<Middleware>(middleware))
			: Service.make<Middleware>(middleware)
	);
};

/**
 * Apply a list of middlewares to an Elysia plugin.
 * @author Axel Nana <axel.nana@workbud.com>
 * @param middlewares The list of middlewares to apply.
 * @param plugin The Elysia plugin instance.
 * @param node The module the middlewares belong to, or `null` for application-level middlewares.
 */
export const applyMiddlewares = (
	middlewares: Class<Middleware>[],
	plugin: AnyElysia,
	node: ModuleNode | null
) => {
	const mi = makeMiddlewares(middlewares, node);

	if (node) {
		// Elysia runs every onRequest hook on every request of the app, whatever plugin registered it.
		// The onRequest middlewares of a module or a controller run first in its transform hook instead,
		// which is scoped to its routes.
		plugin.onTransform(async (c) => {
			return (
				(await executeMiddlewareChain(mi, c, 'onRequest', node)) ??
				executeMiddlewareChain(mi, c, 'onTransform', node)
			);
		});
	} else {
		plugin.onRequest((c) => {
			return executeMiddlewareChain(mi, c, 'onRequest', node);
		});

		plugin.onTransform((c) => {
			return executeMiddlewareChain(mi, c, 'onTransform', node);
		});
	}

	plugin.onBeforeHandle((c) => {
		return executeMiddlewareChain(mi, c, 'onBeforeHandle', node);
	});

	plugin.onAfterHandle((c) => {
		return executeMiddlewareChain(mi, c, 'onAfterHandle', node);
	});

	plugin.onAfterResponse((c) => {
		return executeMiddlewareChain(mi, c, 'onAfterResponse', node);
	});
};

/**
 * Base class for middleware.
 * @author Axel Nana <axel.nana@workbud.com>
 * @template TGuards The list of guards for the middleware.
 */
export abstract class Middleware<TGuards extends string[] = []> {
	/**
	 * Registers a list of middlewares to be applied on a controller or endpoint.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param middlewares The list of middlewares to apply.
	 */
	public static register(...middlewares: Class<Middleware>[]): ClassDecorator & MethodDecorator {
		return function (
			target: Object,
			propertyKey?: string | symbol,
			descriptor?: PropertyDescriptor
		) {
			if (propertyKey === undefined && descriptor === undefined) {
				const m = Metadata.get(Symbols.middlewares, target) ?? [];
				m.push(...middlewares);
				Metadata.define(Symbols.middlewares, m, target);
			} else {
				const m = Metadata.get(Symbols.middlewares, target, propertyKey!) ?? [];
				m.push(...middlewares);
				Metadata.define(Symbols.middlewares, m, target, propertyKey!);
			}
		};
	}

	/**
	 * Creates a guarded version of the middleware.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param guards The list of guards for the middleware.
	 * @returns A middleware class decorated with guards.
	 */
	public static guards(guards: string[]): Class<Middleware> {
		class GuardedMiddleware extends this {}
		Metadata.define(Symbols.middlewareGuards, guards, GuardedMiddleware);
		return GuardedMiddleware;
	}

	/**
	 * Structured application logger resolved from the service container, falling back to a
	 * `ConsoleLogger`. Returns a child logger with the middleware class name in context.
	 * @author Axel Nana <axel.nana@workbud.com>
	 */
	protected get logger(): LoggerInterface {
		return getLogger({ middleware: this.constructor.name });
	}

	/**
	 * Gets the list of guards for the middleware.
	 */
	public get guards(): TGuards {
		return Metadata.get(Symbols.middlewareGuards, this.constructor) ?? [];
	}

	/**
	 * Called first before everything else. This middleware hook works only when used on
	 * a controller, a module, or the application. On the application it runs for every request,
	 * before routing. On a module or a controller it runs only for its routes, after the body is
	 * parsed and right before `onTransform`.
	 * @param _ctx The request context.
	 */
	public onRequest(_ctx: Context): any {}

	/**
	 * Called before validation, but after the request has been parsed.
	 * Use this method to modify the request inputs before validation.
	 * @param _ctx The request context.
	 */
	public onTransform(_ctx: Context): any {}

	/**
	 * Called after the request has been handled, but before the response is sent.
	 * @param _ctx The request context.
	 */
	public onAfterHandle(_ctx: Context): any {}

	/**
	 * Called before the request is handled.
	 * @param _ctx The request context.
	 */
	public onBeforeHandle(_ctx: Context): any {}

	/**
	 * Called after the response has been sent.
	 * @param _ctx The request context.
	 */
	public onAfterResponse(_ctx: Context): any {}
}
