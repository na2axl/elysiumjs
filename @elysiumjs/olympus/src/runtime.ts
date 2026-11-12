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

import type { AnyElysia } from 'elysia';

import { ElysiumError } from './errors';

/**
 * The process signals the application shuts down on.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type ShutdownSignal = 'SIGINT' | 'SIGTERM';

/**
 * A server started by {@link Runtime.serve}, closed when the application shuts down.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type ServeHandle = {
	/** Stops accepting connections and resolves once the server is closed. */
	close(): Promise<void> | void;
};

/**
 * The host-specific operations the framework needs. Core never calls a host API directly
 * (`Bun.*`, `process.exit`, a server's `listen`): it asks the current runtime.
 *
 * Implementations ship as packages: `@elysiumjs/runtime-bun`, `@elysiumjs/runtime-node` and
 * `@elysiumjs/runtime-workers`. Set one with the `runtime` option of `@Application.register()`
 * or with {@link Runtime.use}.
 *
 * The runtime is process-wide: the last application constructed wins.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
/**
 * The level of a line written to the console.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type OutputLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

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
	 * @returns A handle that closes the server, when stopping the Elysia app does not.
	 * @throws {RuntimeNotSupportedError} On runtimes where the host owns the server.
	 */
	serve(app: AnyElysia, port: number): ServeHandle | void;

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
	 * The command line arguments after the script. Empty on runtimes without a command line.
	 */
	argv(): readonly string[];

	/**
	 * Writes text to the standard output or error stream. Runtimes without streams write to
	 * the console instead.
	 * @param stream The stream to write to.
	 * @param text The text to write, as is.
	 * @param level The level of the text, for runtimes whose console keeps one per line, such as
	 * Cloudflare Workers.
	 */
	write(stream: 'stdout' | 'stderr', text: string, level?: OutputLevel): void;

	/**
	 * The interactive terminal, or `undefined` on runtimes without one.
	 */
	terminal(): RuntimeTerminal | undefined;

	/**
	 * The address of the client that sent a request, as the host sees it (before any proxy
	 * headers), or `undefined` when unknown.
	 * @param request The request.
	 */
	clientAddress?(request: Request): string | undefined;
}

/**
 * An interactive terminal, as exposed by a runtime.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export interface RuntimeTerminal {
	/** The stream user input is read from. */
	input: NodeJS.ReadableStream;

	/** The stream output is written to. */
	output: NodeJS.WritableStream;

	/**
	 * Turns raw mode on or off on the input, when supported.
	 * @param on Whether raw mode is on.
	 */
	setRawMode?(on: boolean): void;

	/** Clears the screen. */
	clear(): void;

	/**
	 * Moves the cursor relative to its current position.
	 * @param x The columns to move by.
	 * @param y The rows to move by.
	 */
	moveCursor(x: number, y: number): void;

	/** Clears the current line and moves the cursor to its start. */
	clearLine(): void;
}

/**
 * Thrown when a feature needs a host API the current runtime does not have.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class RuntimeNotSupportedError extends ElysiumError {
	public constructor(feature: string, runtime: string, hint?: string) {
		super(`${feature} is not supported on the ${runtime} runtime.${hint ? ` ${hint}` : ''}`);
	}
}

/**
 * Thrown when the framework needs the runtime before one was set.
 * @author Axel Nana <ax.lnana@outlook.com>
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
	 * @author Axel Nana <ax.lnana@outlook.com>
	 * @throws {RuntimeNotConfiguredError} When no runtime was set.
	 */
	export const get = (): Runtime => {
		if (!current) throw new RuntimeNotConfiguredError();
		return current;
	};

	/**
	 * Gets the runtime in use, or `undefined` when none was set.
	 * @author Axel Nana <ax.lnana@outlook.com>
	 */
	export const find = (): Runtime | undefined => current;

	/**
	 * Sets the runtime to use. The runtime is process-wide: when several applications are
	 * constructed, the last one to set a runtime wins.
	 * @author Axel Nana <ax.lnana@outlook.com>
	 * @param runtime The runtime to use.
	 */
	export const use = (runtime: Runtime): void => {
		current = runtime;
	};

	/**
	 * Forgets the runtime in use.
	 * @author Axel Nana <ax.lnana@outlook.com>
	 */
	export const reset = (): void => {
		current = undefined;
	};
}
