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
 * The process signals the application shuts down on.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type ShutdownSignal = 'SIGINT' | 'SIGTERM';

/**
 * The host-specific operations the framework needs. Core never calls a host API directly
 * (`Bun.*`, `process.exit`, a server's `listen`): it asks the current runtime.
 *
 * Implementations ship as packages: `@elysiumjs/runtime-bun`, `@elysiumjs/runtime-node` and
 * `@elysiumjs/runtime-workers`. Set one with the `runtime` option of `@Application.register()`
 * or with {@link Runtime.use}.
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

/**
 * Thrown when the framework needs the runtime before one was set.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class RuntimeNotConfiguredError extends ElysiumError {
	public constructor() {
		super(
			'No runtime is set. Install @elysiumjs/runtime-bun, @elysiumjs/runtime-node or @elysiumjs/runtime-workers, then pass it as the `runtime` option of @Application.register() or call Runtime.use().'
		);
	}
}

let current: Runtime | undefined;

export namespace Runtime {
	/**
	 * Gets the runtime in use.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @throws {RuntimeNotConfiguredError} When no runtime was set.
	 */
	export const get = (): Runtime => {
		if (!current) throw new RuntimeNotConfiguredError();
		return current;
	};

	/**
	 * Gets the runtime in use, or `undefined` when none was set.
	 * @author Axel Nana <axel.nana@workbud.com>
	 */
	export const find = (): Runtime | undefined => current;

	/**
	 * Sets the runtime to use.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param runtime The runtime to use.
	 */
	export const use = (runtime: Runtime): void => {
		current = runtime;
	};

	/**
	 * Forgets the runtime in use.
	 * @author Axel Nana <axel.nana@workbud.com>
	 */
	export const reset = (): void => {
		current = undefined;
	};
}
