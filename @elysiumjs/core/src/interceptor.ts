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

import { InterceptorNextCalledTwiceError } from './errors';
import { Metadata } from './metadata';
import { ModuleContext } from './module-context';
import { Service, ServiceScope } from './service';
import { Symbols } from './utils';

/**
 * The context an interceptor receives: the Elysia context of the request (`request`, `set`,
 * `params`, `query`, `body`, ...).
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type InterceptorContext = {
	request: Request;
	set: { status?: number | string; headers: Record<string, string | number> };
	[key: string]: unknown;
};

/**
 * Wraps a request handler. `next()` runs the inner interceptors and the handler and resolves to
 * the handler's result; return it, or a replacement. Not calling `next()` skips the handler, and
 * the interceptor's result becomes the response.
 *
 * Interceptors run inside the request scope, the module context and the transaction of the
 * route, after the `onBeforeHandle` middlewares and before the `onAfterHandle` ones. Streaming
 * routes (generators and server-sent events) do not run them.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export interface Interceptor {
	intercept(ctx: InterceptorContext, next: () => Promise<unknown>): Promise<unknown>;
}

/**
 * A class of interceptor. Interceptors are services: they can inject other services of their
 * module. A request-scoped interceptor is built for each request.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type InterceptorClass = Class<Interceptor>;

/**
 * One level of interceptors (app, module, controller or route) and the module they run in.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type InterceptorLevel = { interceptors: InterceptorClass[]; node: ModuleNode | null };

const singletons = new WeakMap<InterceptorLevel, Map<InterceptorClass, Interceptor>>();

const build = (level: InterceptorLevel, cls: InterceptorClass): Interceptor => {
	const make = () =>
		level.node
			? ModuleContext.run(level.node, () => Service.make<Interceptor>(cls))
			: Service.make<Interceptor>(cls);

	const scope = Metadata.get(Symbols.serviceOptions, cls)?.scope;
	if (scope === ServiceScope.REQUEST || scope === ServiceScope.FACTORY) return make();

	let built = singletons.get(level);
	if (!built) singletons.set(level, (built = new Map()));
	let instance = built.get(cls);
	if (!instance) built.set(cls, (instance = make()));
	return instance;
};

/**
 * Runs a handler through interceptors, the first one outermost. Each interceptor runs in its
 * module's context.
 * @author Axel Nana <axel.nana@workbud.com>
 * @param levels The levels, outermost first (app, module, controller, route).
 * @param ctx The request context.
 * @param handler Runs the handler.
 * @throws {InterceptorNextCalledTwiceError} When an interceptor calls `next()` twice.
 */
export const runInterceptors = (
	levels: InterceptorLevel[],
	ctx: InterceptorContext,
	handler: () => Promise<unknown>
): Promise<unknown> => {
	const chain = levels.flatMap((level) => level.interceptors.map((cls) => ({ level, cls })));

	const step = (index: number): Promise<unknown> => {
		if (index === chain.length) return handler();
		const { level, cls } = chain[index]!;
		let called = false;
		const next = () => {
			if (called) return Promise.reject(new InterceptorNextCalledTwiceError(cls.name));
			called = true;
			return step(index + 1);
		};
		const run = () => build(level, cls).intercept(ctx, next);
		return level.node ? ModuleContext.run(level.node, run) : run();
	};

	return step(0);
};

/**
 * Adds a `Server-Timing` entry with the duration of the handler and of the interceptors inside
 * this one: `handler;dur=12.3`.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class TimingInterceptor implements Interceptor {
	public async intercept(ctx: InterceptorContext, next: () => Promise<unknown>): Promise<unknown> {
		const start = performance.now();
		try {
			return await next();
		} finally {
			const entry = `handler;dur=${(performance.now() - start).toFixed(1)}`;
			const current = ctx.set.headers['server-timing'];
			ctx.set.headers['server-timing'] = current ? `${current}, ${entry}` : entry;
		}
	}
}

/**
 * Builds interceptors that transform the result of handlers.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export abstract class TransformInterceptor {
	/**
	 * Creates an interceptor class that passes each handler result through `transform`.
	 * @param transform Receives the result and the request context; returns the new result.
	 * @example
	 * ```ts
	 * @Http.controller({ path: '/posts', interceptors: [TransformInterceptor.with((data) => ({ data }))] })
	 * ```
	 */
	public static with(
		transform: (result: unknown, ctx: InterceptorContext) => unknown | Promise<unknown>
	): InterceptorClass {
		return class Transform implements Interceptor {
			public async intercept(ctx: InterceptorContext, next: () => Promise<unknown>) {
				return transform(await next(), ctx);
			}
		};
	}
}
