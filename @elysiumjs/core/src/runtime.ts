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

import { ElysiumError } from './errors';

/**
 * The minimal surface of a Redis client the framework relies on.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export interface RedisClientLike {
	close(): void | Promise<void>;
}

/**
 * The process signals the application shuts down on.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type ShutdownSignal = 'SIGINT' | 'SIGTERM';

/**
 * The host-specific operations the framework needs. Core never calls a host API directly
 * (`Bun.*`, `process.exit`, a server's `listen`): it asks the current runtime.
 *
 * The runtime is detected when first needed, and can be replaced with {@link Runtime.use}.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export interface Runtime {
	/** A short name for the runtime, used in error messages. */
	readonly name: string;

	/** The raw environment variables, before validation. */
	env(): Record<string, string | undefined>;

	/**
	 * Waits for the given duration.
	 * @param ms The duration, in milliseconds.
	 */
	sleep(ms: number): Promise<void>;

	/**
	 * Starts serving the app on the given port.
	 * @param app The root Elysia app.
	 * @param port The port to listen on.
	 * @throws {RuntimeNotSupportedError} On runtimes where the host owns the server.
	 */
	serve(app: AnyElysia, port: number): void;

	/**
	 * Ends the process with the given exit code. A no-op on runtimes without a process.
	 * @param code The exit code.
	 */
	exit(code: number): void;

	/**
	 * Calls `handler` when the process is asked to stop.
	 * @param handler The handler to call.
	 * @returns A function that removes the handler.
	 */
	onShutdown(handler: () => void): () => void;

	/**
	 * Creates a Redis client.
	 * @param url The connection URL.
	 * @param options The client options.
	 * @throws {RuntimeNotSupportedError} On runtimes without a built-in Redis client.
	 */
	createRedisClient(url: string, options: Record<string, unknown>): RedisClientLike;
}

/**
 * Thrown when a feature needs a host API the current runtime does not have.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class RuntimeNotSupportedError extends ElysiumError {
	public constructor(feature: string, runtime: string, hint?: string) {
		super(`${feature} is not supported on the ${runtime} runtime.${hint ? ` ${hint}` : ''}`);
	}
}

/** The parts of the Bun global the Bun runtime uses. Read lazily, never at import. */
type BunGlobal = {
	RedisClient: new (url: string, options?: Record<string, unknown>) => RedisClientLike;
};

const SIGNALS: ShutdownSignal[] = ['SIGINT', 'SIGTERM'];

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const processEnv = (): Record<string, string | undefined> =>
	typeof process !== 'undefined' && process.env ? process.env : {};

/**
 * The runtime for Bun.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export const bunRuntime: Runtime = {
	name: 'bun',
	env: processEnv,
	sleep,
	serve(app, port) {
		app.listen(port);
	},
	exit(code) {
		process.exit(code);
	},
	onShutdown(handler) {
		for (const signal of SIGNALS) process.on(signal, handler);
		return () => {
			for (const signal of SIGNALS) process.off(signal, handler);
		};
	},
	createRedisClient(url, options) {
		const bun = (globalThis as unknown as { Bun: BunGlobal }).Bun;
		return new bun.RedisClient(url, options);
	}
};

/**
 * The runtime for Node.js: the same as Bun's, without a built-in Redis client.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export const nodeRuntime: Runtime = {
	...bunRuntime,
	name: 'node',
	createRedisClient() {
		throw new RuntimeNotSupportedError('RedisModule', 'node');
	}
};

/**
 * The runtime for Cloudflare Workers. The host owns the server and the isolate's lifetime:
 * export the app's `fetch` instead of calling `serve`, and nothing exits or receives signals.
 *
 * Environment variables come from `process.env` (populated from the Worker's vars with the
 * `nodejs_compat` flag); pass `env` to use other values.
 * @param options The environment to expose, when not `process.env`.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export const createWorkersRuntime = (
	options: { env?: Record<string, string | undefined> } = {}
): Runtime => ({
	name: 'workers',
	env: () => options.env ?? processEnv(),
	sleep,
	serve() {
		throw new RuntimeNotSupportedError(
			'Application.serve',
			'workers',
			"Export the app's fetch handler from the Worker instead."
		);
	},
	exit() {},
	onShutdown() {
		return () => {};
	},
	createRedisClient() {
		throw new RuntimeNotSupportedError('RedisModule', 'workers');
	}
});

let current: Runtime | undefined;

export namespace Runtime {
	/**
	 * Picks the runtime for the host the code runs on.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param scope The global object to inspect.
	 */
	export const detect = (scope: object = globalThis): Runtime => {
		if ('Bun' in scope) return bunRuntime;
		const { navigator } = scope as { navigator?: { userAgent?: string } };
		if (navigator?.userAgent === 'Cloudflare-Workers') return createWorkersRuntime();
		return nodeRuntime;
	};

	/**
	 * Gets the runtime in use, detecting it on first call.
	 * @author Axel Nana <axel.nana@workbud.com>
	 */
	export const get = (): Runtime => (current ??= detect());

	/**
	 * Replaces the runtime in use.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param runtime The runtime to use.
	 */
	export const use = (runtime: Runtime): void => {
		current = runtime;
	};

	/**
	 * Forgets the runtime in use, so the next {@link Runtime.get} detects it again.
	 * @author Axel Nana <axel.nana@workbud.com>
	 */
	export const reset = (): void => {
		current = undefined;
	};
}
