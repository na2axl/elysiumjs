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

import type { LoggerInterface, LoggerOptions } from '@elysiumjs/olympus';
import type { Logger as Pino } from 'pino';

import { Logger } from '@elysiumjs/olympus';
import pino from 'pino';

declare module '@elysiumjs/olympus' {
	interface PortDrivers {
		'logger:pino': typeof PinoLogger;
	}
}

/**
 * The `pino` driver of the `Logger` port: JSON lines through pino, or readable lines through
 * pino-pretty with `format: 'pretty'`. Importing the package registers it, and `LoggerModule`
 * then uses it by default, except on Cloudflare Workers.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @example
 * ```ts
 * import '@elysiumjs/pino';
 *
 * LoggerModule.with({ name: 'shop', level: 'debug', format: 'pretty' });
 * ```
 */
@Logger.driver('pino')
export class PinoLogger implements LoggerInterface {
	private pino: Pino;
	private config: LoggerOptions;

	constructor(config: LoggerOptions = {}) {
		this.config = { level: 'info', format: 'json', ...config };
		this.pino = this.createPinoInstance();
	}

	private createPinoInstance(): Pino {
		const options: pino.LoggerOptions = {
			level: this.config.level,
			name: this.config.name,
			// Elysium logs errors under `error`; pino only serialises `err` by default.
			serializers: { error: pino.stdSerializers.err }
		};

		if (this.config.format === 'pretty') {
			return pino(options, pino.transport({ target: 'pino-pretty' }));
		}

		return pino(options);
	}

	public trace(msg: string, ctx?: Record<string, unknown>): void {
		this.pino.trace(ctx ?? {}, msg);
	}

	public debug(msg: string, ctx?: Record<string, unknown>): void {
		this.pino.debug(ctx ?? {}, msg);
	}

	public info(msg: string, ctx?: Record<string, unknown>): void {
		this.pino.info(ctx ?? {}, msg);
	}

	public warn(msg: string, ctx?: Record<string, unknown>): void {
		this.pino.warn(ctx ?? {}, msg);
	}

	public error(msg: string, ctx?: Record<string, unknown>): void {
		this.pino.error(ctx ?? {}, msg);
	}

	public fatal(msg: string, ctx?: Record<string, unknown>): void {
		this.pino.fatal(ctx ?? {}, msg);
	}

	/**
	 * Flushes buffered log lines of the underlying transport, when it supports it.
	 * @author Axel Nana <ax.lnana@outlook.com>
	 */
	public flush(): void {
		this.pino.flush?.();
	}

	/** Flushes on shutdown. Only called for a logger the container built. */
	public onDestroy(): void {
		this.flush();
	}

	public child(ctx: Record<string, unknown>): PinoLogger {
		const child = Object.create(this) as PinoLogger;
		child.pino = this.pino.child(ctx);
		return child;
	}
}
