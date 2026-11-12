// Copyright (c) 2026-present Axel Nana <ax.lnana@outlook.com>. All rights reserved.
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
import type { WorkersHandler, WorkersMessageBatch, WorkersQueueMessage } from './types';
import type { WorkersHandlerMeta } from './workers';

import { getLogger, ModuleContext, Service } from '@elysiumjs/core';

import { DuplicateQueueConsumerError, NoWorkersHandlerError } from './errors';
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

/** Refuses two consumers of one named queue. */
const assertOneConsumerPerQueue = (handlers: Handler[]): void => {
	const consumers = new Map<string, string[]>();
	for (const handler of handlers) {
		if (handler.kind !== 'queue' || handler.key === '*') continue;
		const names = consumers.get(handler.key) ?? [];
		const name = `${handler.cls.name}.${String(handler.method)}`;
		if (!names.includes(name)) names.push(name);
		consumers.set(handler.key, names);
	}
	for (const [queue, names] of consumers) {
		if (names.length > 1) throw new DuplicateQueueConsumerError(queue, names);
	}
};

/**
 * Disposes the request scope once the response body has been sent, or cancelled by the client,
 * so that a streamed body (server-sent events, generators) keeps its request services while it
 * runs. Disposal outlives the response: it is handed to `waitUntil`, and the runtime keeps the
 * Worker alive until it ends.
 */
const disposeAfterBody = (request: Request, response: Response): Response => {
	const ctx = Workers.context();
	const source = response.body;
	if (!source || response.status === 101) {
		ctx.waitUntil(Service.disposeRequestScope(request));
		return response;
	}

	let ended!: () => void;
	ctx.waitUntil(
		new Promise<void>((resolve) => (ended = resolve)).then(() =>
			Service.disposeRequestScope(request)
		)
	);

	const reader = source.getReader();
	const body = new ReadableStream<Uint8Array>({
		async pull(controller) {
			try {
				const { done, value } = await reader.read();
				if (done) {
					controller.close();
					ended();
				} else {
					controller.enqueue(value);
				}
			} catch (error) {
				controller.error(error);
				ended();
			}
		},
		async cancel(reason) {
			ended();
			await reader.cancel(reason);
		}
	});
	return new Response(body, response);
};

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
 * Wraps a message so that a handler can settle it itself (`ack()`, or `retry()` with a delay); a
 * settled message is left as the handler settled it.
 */
const settleable = (
	message: WorkersQueueMessage,
	settled: Set<WorkersQueueMessage>
): WorkersQueueMessage => ({
	get id() {
		return message.id;
	},
	get timestamp() {
		return message.timestamp;
	},
	get body() {
		return message.body;
	},
	get attempts() {
		return message.attempts;
	},
	ack: () => {
		settled.add(message);
		message.ack();
	},
	retry: (options) => {
		settled.add(message);
		message.retry(options);
	}
});

/**
 * Runs the queue handlers matching the batch, then acks the messages no handler failed on and
 * retries the others, except those a handler settled itself. A failing handler never rejects the
 * batch.
 */
const dispatchQueue = async (handlers: Handler[], batch: WorkersMessageBatch): Promise<void> => {
	const matching = handlers.filter(
		(h) => h.kind === 'queue' && (h.key === batch.queue || h.key === '*')
	);
	if (matching.length === 0) throw new NoWorkersHandlerError('queue', batch.queue);

	const failed = new Set<number>();
	const settled = new Set<WorkersQueueMessage>();
	const log = (handler: Handler, error: unknown) =>
		getLogger().error('Queue handler failed', {
			queue: batch.queue,
			handler: `${handler.cls.name}.${String(handler.method)}`,
			error
		});

	for (const handler of matching) {
		if (handler.each) {
			for (const [index, message] of batch.messages.entries()) {
				try {
					await runHandler(handler, settleable(message, settled));
				} catch (error) {
					failed.add(index);
					log(handler, error);
				}
			}
		} else {
			try {
				await runHandler(handler, batch);
			} catch (error) {
				batch.messages.forEach((_, index) => failed.add(index));
				log(handler, error);
			}
		}
	}

	for (const [index, message] of batch.messages.entries()) {
		if (settled.has(message)) continue;
		if (failed.has(index)) message.retry();
		else message.ack();
	}
};

/**
 * Builds an application and returns the handlers a Cloudflare Worker module exports.
 *
 * - `fetch` serves the app's routes.
 * - `queue` hands each batch to the service method marked `@Workers.queue(name)`, and to those
 *   marked `@Workers.queue('*')`, then acks or retries each message on its own. A named queue has
 *   one consumer: two are refused when the Worker is created.
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
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export const createWorker = async <Env = Record<string, unknown>>(
	app: Application
): Promise<WorkersHandler<Env> & { readonly app: Elysia<any> }> => {
	const elysia = await app.build();
	const handlers = collectHandlers(app);
	assertOneConsumerPerQueue(handlers);

	return {
		app: elysia,
		fetch: (request, env, ctx) =>
			runInvocation({ env: env as Record<string, unknown>, ctx }, async () => {
				let response: Response | undefined;
				try {
					response = await elysia.fetch(request);
					return disposeAfterBody(request, response);
				} finally {
					if (!response) Workers.context().waitUntil(Service.disposeRequestScope(request));
				}
			}),

		queue: (batch, env, ctx) =>
			runInvocation({ env: env as Record<string, unknown>, ctx }, async () => {
				await app.boot();
				await dispatchQueue(handlers, batch);
			}),

		scheduled: (controller, env, ctx) =>
			runInvocation({ env: env as Record<string, unknown>, ctx }, async () => {
				await app.boot();
				await dispatch(handlers, 'cron', controller.cron, controller);
			})
	};
};
