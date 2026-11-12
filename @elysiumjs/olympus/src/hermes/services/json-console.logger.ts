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

import type { LoggerInterface } from '../../index';
import type { HermesConfig, LogLevel } from '../types';

import { InteractsWithConsole } from '../../index';

import { DEFAULT_CONFIG } from '../types';

const LEVELS: Record<LogLevel, number> = {
	trace: 10,
	debug: 20,
	info: 30,
	warn: 40,
	error: 50,
	fatal: 60
};

/** Turns errors into plain objects, so that they survive `JSON.stringify`. */
const serializable = (value: unknown): unknown => {
	if (value instanceof Error) {
		return {
			type: value.name,
			message: value.message,
			stack: value.stack,
			...(value.cause !== undefined ? { cause: serializable(value.cause) } : {})
		};
	}
	return value;
};

/**
 * A logger that writes one JSON object per line, with the same fields as the pino logger
 * (`level`, `time`, `name`, `msg` and the context), through the console of the runtime: the
 * standard streams on Bun and Node.js (warnings and errors on stderr), and the console method of
 * each level on Cloudflare Workers, where Workers Logs index the fields and keep the level.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class JsonConsoleLogger implements LoggerInterface {
	readonly #console = new InteractsWithConsole();
	readonly #threshold: number;
	readonly #bindings: Record<string, unknown>;

	constructor(config: Partial<HermesConfig> = {}, bindings: Record<string, unknown> = {}) {
		const level = config.level ?? DEFAULT_CONFIG.level;
		this.#threshold = LEVELS[level];
		this.#bindings = { ...(config.name ? { name: config.name } : {}), ...bindings };
		this.level = level;
	}

	/** The lowest level written. */
	public readonly level: LogLevel;

	public trace(msg: string, ctx?: Record<string, unknown>): void {
		this.#write('trace', msg, ctx);
	}

	public debug(msg: string, ctx?: Record<string, unknown>): void {
		this.#write('debug', msg, ctx);
	}

	public info(msg: string, ctx?: Record<string, unknown>): void {
		this.#write('info', msg, ctx);
	}

	public warn(msg: string, ctx?: Record<string, unknown>): void {
		this.#write('warn', msg, ctx);
	}

	public error(msg: string, ctx?: Record<string, unknown>): void {
		this.#write('error', msg, ctx);
	}

	public fatal(msg: string, ctx?: Record<string, unknown>): void {
		this.#write('fatal', msg, ctx);
	}

	public child(ctx: Record<string, unknown>): JsonConsoleLogger {
		return new JsonConsoleLogger({ level: this.level }, { ...this.#bindings, ...ctx });
	}

	#write(level: LogLevel, msg: string, ctx?: Record<string, unknown>): void {
		if (LEVELS[level] < this.#threshold) return;
		const entry: Record<string, unknown> = {
			level: LEVELS[level],
			time: Date.now(),
			...this.#bindings
		};
		for (const [key, value] of Object.entries(ctx ?? {})) entry[key] = serializable(value);
		entry.msg = msg;
		let line: string;
		try {
			line = JSON.stringify(entry);
		} catch {
			line = JSON.stringify({ level: entry.level, time: entry.time, msg, unserializable: true });
		}
		this.#console.write(line, true, LEVELS[level] >= LEVELS.warn ? 'stderr' : 'stdout', level);
	}
}
