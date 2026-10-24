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

import type { LoggerInterface } from '@elysiumjs/core';
import type { Logger as PinoLogger } from 'pino';
import type { HermesConfig } from '../types';

import { Service } from '@elysiumjs/core';
import pino from 'pino';

import { DEFAULT_CONFIG } from '../types';

/**
 * Production-ready logger implementation wrapping Pino.
 * Implements `LoggerInterface` from `@elysiumjs/core`.
 *
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class HermesLogger implements LoggerInterface {
	private pino: PinoLogger;
	private config: HermesConfig;

	public static make(name: string): HermesLogger {
		return Service.get(HermesLogger)?.child({ name }) ?? new HermesLogger({ name });
	}

	constructor(config: Partial<HermesConfig> = {}) {
		this.config = { ...DEFAULT_CONFIG, ...config };
		this.pino = this.createPinoInstance();
	}

	private createPinoInstance(): PinoLogger {
		const options: pino.LoggerOptions = {
			level: this.config.level,
			name: this.config.name
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
	 * @author Axel Nana <axel.nana@workbud.com>
	 */
	public flush(): void {
		this.pino.flush?.();
	}

	/** Flushes on shutdown. Only called for a logger the container built. */
	public onDestroy(): void {
		this.flush();
	}

	public child(ctx: Record<string, unknown>): HermesLogger {
		const child = Object.create(this) as HermesLogger;
		child.pino = this.pino.child(ctx);
		return child;
	}
}
