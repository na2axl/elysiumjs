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

import { Container } from './container';

/**
 * Interface for structured application logging.
 *
 * This is distinct from `InteractsWithConsole` (Styx):
 * - `LoggerInterface`: structured application logging (machine-parseable, sent to transports)
 * - `InteractsWithConsole`: CLI user output (colors, spinners, formatted for humans)
 *
 * @author Axel Nana <axel.nana@workbud.com>
 */
export interface LoggerInterface {
	trace(msg: string, ctx?: Record<string, unknown>): void;
	debug(msg: string, ctx?: Record<string, unknown>): void;
	info(msg: string, ctx?: Record<string, unknown>): void;
	warn(msg: string, ctx?: Record<string, unknown>): void;
	error(msg: string, ctx?: Record<string, unknown>): void;
	fatal(msg: string, ctx?: Record<string, unknown>): void;
	child(ctx: Record<string, unknown>): LoggerInterface;
}

/**
 * Default logger implementation using console.* APIs.
 * Used as fallback when @elysiumjs/hermes is not installed.
 *
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class ConsoleLogger implements LoggerInterface {
	private context: Record<string, unknown>;

	constructor(context: Record<string, unknown> = {}) {
		this.context = context;
	}

	public trace(msg: string, ctx?: Record<string, unknown>): void {
		console.debug(`[TRACE] ${msg}`, { ...this.context, ...ctx });
	}

	public debug(msg: string, ctx?: Record<string, unknown>): void {
		console.debug(`[DEBUG] ${msg}`, { ...this.context, ...ctx });
	}

	public info(msg: string, ctx?: Record<string, unknown>): void {
		console.info(`[INFO] ${msg}`, { ...this.context, ...ctx });
	}

	public warn(msg: string, ctx?: Record<string, unknown>): void {
		console.warn(`[WARN] ${msg}`, { ...this.context, ...ctx });
	}

	public error(msg: string, ctx?: Record<string, unknown>): void {
		console.error(`[ERROR] ${msg}`, { ...this.context, ...ctx });
	}

	public fatal(msg: string, ctx?: Record<string, unknown>): void {
		console.error(`[FATAL] ${msg}`, { ...this.context, ...ctx });
	}

	public child(ctx: Record<string, unknown>): LoggerInterface {
		return new ConsoleLogger({ ...this.context, ...ctx });
	}
}

/**
 * The name of the global service holding the application logger.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export const LOGGER_SERVICE = 'logger';

/**
 * Resolves the application logger at call time: the `logger` service when one is registered
 * (e.g. by `@elysiumjs/hermes`), a {@link ConsoleLogger} otherwise or when it cannot be built.
 * @author Axel Nana <axel.nana@workbud.com>
 * @param context Optional context bound to the returned logger, as a child logger.
 * @returns The application logger, or a child of it when `context` is given.
 */
export const getLogger = (context?: Record<string, unknown>): LoggerInterface => {
	let logger: LoggerInterface | null = null;
	try {
		logger = Container.getGlobal(LOGGER_SERVICE) as LoggerInterface | null;
	} catch {
		// Logging must not fail because the logger service is not ready or failed to build.
	}

	const base = logger ?? new ConsoleLogger();
	return context ? base.child(context) : base;
};
