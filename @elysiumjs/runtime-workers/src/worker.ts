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

import type { Application, Elysia, ModuleNode } from '@elysiumjs/core';
import type { WorkersHandler } from './types';
import type { WorkersHandlerMeta } from './workers';

import { ModuleContext, Service } from '@elysiumjs/core';

import { NoWorkersHandlerError } from './errors';
import { runInvocation } from './invocation';
import { Workers } from './workers';

type Handler = WorkersHandlerMeta & { node: ModuleNode; cls: new (...args: any[]) => unknown };

/** The queue and cron handlers declared on the services of the app's modules. */
const collectHandlers = (app: Application): Handler[] =>
	app.kernel.graph.nodes.flatMap((node) =>
		app.kernel
			.serviceClasses(node)
			.flatMap((cls) => Workers.handlersOf(cls).map((meta) => ({ ...meta, node, cls })))
	);

/** Runs a handler in its module, in a request scope of its own. */
const runHandler = (handler: Handler, argument: unknown): Promise<void> =>
	ModuleContext.run(handler.node, () =>
		Service.runInRequestScope(async () => {
			const instance = await Service.resolve<Record<PropertyKey, (arg: unknown) => unknown>>(
				handler.cls
			);
			await instance[handler.method]!(argument);
		})
	);

/** Runs every handler matching `key`, one after the other. */
const dispatch = async (
	handlers: Handler[],
	kind: Handler['kind'],
	key: string,
	argument: unknown
): Promise<void> => {
	const matching = handlers.filter((h) => h.kind === kind && (h.key === key || h.key === '*'));
	if (matching.length === 0) throw new NoWorkersHandlerError(kind, key);
	for (const handler of matching) await runHandler(handler, argument);
};

/**
 * Builds an application and returns the handlers a Cloudflare Worker module exports.
 *
 * - `fetch` serves the app's routes.
 * - `queue` hands each batch to the service methods marked `@Workers.queue(name)`.
 * - `scheduled` calls the service methods marked `@Workers.cron(expression)`.
 *
 * Each invocation runs with its own env and execution context, read with `Workers.env()`,
 * `Workers.binding(name)` or the services of `WorkersModule`. Modules boot on the first
 * invocation, whatever its kind.
 *
 * The result also holds the root Elysia `app`. Export it as `app` from the Worker entry so that
 * `elysia/plugin/aot` compiles the routes at build time.
 *
 * @example
 * ```ts
 * const worker = await createWorker(new App());
 * export const app = worker.app;
 * export default worker;
 * ```
 * @param app The application to serve.
 * @returns The `fetch`, `queue` and `scheduled` handlers, and the root Elysia app.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export const createWorker = async <Env = Record<string, unknown>>(
	app: Application
): Promise<WorkersHandler<Env> & { readonly app: Elysia<any> }> => {
	const elysia = await app.build();
	const handlers = collectHandlers(app);

	return {
		app: elysia,
		fetch: (request, env, ctx) =>
			runInvocation({ env: env as Record<string, unknown>, ctx }, async () => {
				try {
					return await elysia.fetch(request);
				} finally {
					// Disposal outlives the response: the runtime keeps the Worker alive until it ends.
					Workers.context().waitUntil(Service.disposeRequestScope(request));
				}
			}),

		queue: (batch, env, ctx) =>
			runInvocation({ env: env as Record<string, unknown>, ctx }, async () => {
				await app.boot();
				await dispatch(handlers, 'queue', batch.queue, batch);
			}),

		scheduled: (controller, env, ctx) =>
			runInvocation({ env: env as Record<string, unknown>, ctx }, async () => {
				await app.boot();
				await dispatch(handlers, 'cron', controller.cron, controller);
			})
	};
};
