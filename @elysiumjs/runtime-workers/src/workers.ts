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

import type { WorkersExecutionContext } from './types';

import { Metadata, Service } from '@elysiumjs/core';

import { BindingNotFoundError, OutsideInvocationError } from './errors';
import { currentInvocation } from './invocation';

/** Name of the request-scoped service holding the Worker's env. */
export const WORKERS_ENV_SERVICE = 'workers.env';

/** Name of the request-scoped service holding the invocation's execution context. */
export const WORKERS_CONTEXT_SERVICE = 'workers.context';

/**
 * A method that handles queue batches or scheduled events.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type WorkersHandlerMeta = {
	/** What the method handles. */
	readonly kind: 'queue' | 'cron';
	/** The queue name or the cron expression; `*` matches every queue or cron. */
	readonly key: string;
	/** The method name. */
	readonly method: PropertyKey;
	/** Queue handlers only: whether the method receives one message at a time. */
	readonly each?: boolean;
};

/**
 * Options of `@Workers.queue`.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type WorkersQueueOptions = {
	/** Receive one message at a time instead of the batch, so failures retry only that message. */
	readonly each?: boolean;
};

const HANDLERS = Symbol('workers:handlers');

const addHandler = (
	kind: WorkersHandlerMeta['kind'],
	key: string,
	each?: boolean
): MethodDecorator => {
	return (target, method) => {
		if (typeof target === 'function') {
			throw new TypeError(`@Workers.${kind}() goes on an instance method, not on a static one.`);
		}
		const cls = target.constructor;
		const handlers: WorkersHandlerMeta[] = Metadata.getOwn(HANDLERS, cls) ?? [];
		Metadata.define(HANDLERS, [...handlers, { kind, key, method, ...(each ? { each } : {}) }], cls);
	};
};

export namespace Workers {
	/**
	 * The Worker's env (bindings, vars and secrets) for the current invocation.
	 * @throws {OutsideInvocationError} Outside a request, a queue batch or a scheduled event.
	 */
	export const env = <Env = Record<string, unknown>>(): Env => {
		const invocation = currentInvocation();
		if (!invocation) throw new OutsideInvocationError('The Worker env');
		return invocation.env as Env;
	};

	/**
	 * The execution context of the current invocation, for `waitUntil`.
	 * @throws {OutsideInvocationError} Outside a request, a queue batch or a scheduled event.
	 */
	export const context = (): WorkersExecutionContext => {
		const invocation = currentInvocation();
		if (!invocation) throw new OutsideInvocationError('The execution context');
		return invocation.ctx;
	};

	/**
	 * A binding of the current invocation.
	 * @param name The binding name, as declared in the wrangler config.
	 * @throws {OutsideInvocationError} Outside a request, a queue batch or a scheduled event.
	 * @throws {BindingNotFoundError} When the Worker has no such binding.
	 */
	export const binding = <T = unknown>(name: string): T => {
		const value = env()[name];
		if (value === undefined) throw new BindingNotFoundError(name);
		return value as T;
	};

	/**
	 * The name of the service holding a binding, registered by `WorkersModule`.
	 * @param name The binding name.
	 */
	export const bindingService = (name: string): string => `workers.binding.${name}`;

	/**
	 * Injects a binding listed in `WorkersModule.with({ bindings })`. The binding is
	 * request-scoped, so only request-scoped services, factories and request-scoped
	 * controllers can take it.
	 * @param name The binding name.
	 */
	export const inject = (name: string): ParameterDecorator => Service.inject(bindingService(name));

	/**
	 * Marks a method of a module service as the consumer of a queue. It receives the batch;
	 * when it throws, every message is retried. With `{ each: true }` it receives one message
	 * at a time, and only the messages it throws on are retried. After all handlers ran, the
	 * messages that no handler failed on are acked.
	 * @param queue The queue name, or `*` for every queue.
	 * @param options Set `each` to handle messages one by one.
	 */
	export const queue = (queue: string, options?: WorkersQueueOptions): MethodDecorator =>
		addHandler('queue', queue, options?.each);

	/**
	 * Marks a method of a module service as the handler of a cron trigger. It receives the
	 * scheduled controller.
	 * @param cron The cron expression, exactly as in the wrangler config, or `*` for every cron.
	 */
	export const cron = (cron: string): MethodDecorator => addHandler('cron', cron);

	/**
	 * The queue and cron handlers declared on a class.
	 * @param cls The class.
	 */
	export const handlersOf = (cls: object): readonly WorkersHandlerMeta[] =>
		Metadata.get(HANDLERS, cls) ?? [];
}
