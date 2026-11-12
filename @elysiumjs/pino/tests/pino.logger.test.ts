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

import { runtime as bunRuntime } from '@elysiumjs/bun';
import {
	Application,
	JsonConsoleLogger,
	Logger,
	LoggerModule,
	Runtime,
	Service
} from '@elysiumjs/olympus';
import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import pino from 'pino';

import { PinoLogger } from '../src';

Runtime.use(bunRuntime);

describe('PinoLogger', () => {
	beforeEach(() => {
		Service.clear();
	});

	describe('constructor', () => {
		it('should create a logger with default config', () => {
			const logger = new PinoLogger();
			expect(logger).toBeDefined();
		});

		it('should create a logger with custom config', () => {
			const logger = new PinoLogger({ level: 'debug', name: 'test' });
			expect(logger).toBeDefined();
		});

		it('should create a logger with pretty format', () => {
			const logger = new PinoLogger({ level: 'info', format: 'pretty' });
			expect(logger).toBeDefined();
		});
	});

	describe('log methods', () => {
		let logger: PinoLogger;

		beforeEach(() => {
			logger = new PinoLogger({ level: 'trace' });
		});

		it('should call trace without error', () => {
			expect(() => logger.trace('trace message')).not.toThrow();
		});

		it('should call debug without error', () => {
			expect(() => logger.debug('debug message')).not.toThrow();
		});

		it('should call info without error', () => {
			expect(() => logger.info('info message')).not.toThrow();
		});

		it('should call warn without error', () => {
			expect(() => logger.warn('warn message')).not.toThrow();
		});

		it('should call error without error', () => {
			expect(() => logger.error('error message')).not.toThrow();
		});

		it('should call fatal without error', () => {
			expect(() => logger.fatal('fatal message')).not.toThrow();
		});

		it('should accept context objects', () => {
			expect(() => logger.info('with context', { userId: '123' })).not.toThrow();
		});

		it('should accept undefined context', () => {
			expect(() => logger.info('no context', undefined)).not.toThrow();
		});
	});

	describe('error serialisation', () => {
		/** Captures the lines written by the logger's underlying pino instance. */
		const capture = (logger: PinoLogger): Record<string, any>[] => {
			const lines: Record<string, any>[] = [];
			(logger as any).pino[pino.symbols.streamSym] = {
				write: (line: string) => lines.push(JSON.parse(line))
			};
			return lines;
		};

		it('serialises an Error in the `error` field with its message and stack', () => {
			const logger = new PinoLogger({ level: 'info' });
			const lines = capture(logger);

			logger.error('failed', { error: new Error('boom'), target: 'x' });

			expect(lines[0].msg).toBe('failed');
			expect(lines[0].target).toBe('x');
			expect(lines[0].error).toMatchObject({ type: 'Error', message: 'boom' });
			expect(lines[0].error.stack).toContain('Error: boom');
		});

		it('serialises the `error` field on child loggers', () => {
			const logger = new PinoLogger({ level: 'info' });
			const lines = capture(logger);

			logger.child({ component: 'test' }).warn('retrying', { error: new Error('boom') });

			expect(lines[0].component).toBe('test');
			expect(lines[0].error).toMatchObject({ type: 'Error', message: 'boom' });
		});

		it('keeps a non-Error `error` value as is', () => {
			const logger = new PinoLogger({ level: 'info' });
			const lines = capture(logger);

			logger.error('failed', { error: 'plain' });

			expect(lines[0].error).toBe('plain');
		});
	});

	describe('child()', () => {
		it('should create a child logger', () => {
			const logger = new PinoLogger({ level: 'info' });
			const child = logger.child({ service: 'test' });

			expect(child).toBeDefined();
			expect(child).toBeInstanceOf(PinoLogger);
		});

		it('should be able to log from child', () => {
			const logger = new PinoLogger({ level: 'info' });
			const child = logger.child({ service: 'test' });

			expect(() => child.info('child message')).not.toThrow();
		});
	});

	describe('Logger port', () => {
		it('registers as the pino driver', () => {
			expect(Logger.has('pino')).toBe(true);
			expect(Logger.for('pino', { level: 'debug' })).toBeInstanceOf(PinoLogger);
		});
	});

	describe('LoggerModule', () => {
		let app: Awaited<ReturnType<typeof Application.testing>> | undefined;

		afterEach(async () => {
			await app?.shutdown();
			app = undefined;
		});

		it('is the default logger once loaded, built from the config', async () => {
			app = await Application.testing({ modules: [LoggerModule.with({ level: 'debug' })] });
			const logger = await app.get<PinoLogger>('logger');
			expect(logger).toBeInstanceOf(PinoLogger);
			expect((logger as any).pino.level).toBe('debug');
		});

		it('keeps the console driver on Cloudflare Workers', async () => {
			const navigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
			Object.defineProperty(globalThis, 'navigator', {
				value: { userAgent: 'Cloudflare-Workers' },
				configurable: true
			});
			try {
				app = await Application.testing({ modules: [LoggerModule] });
				expect(await app.get('logger')).toBeInstanceOf(JsonConsoleLogger);
			} finally {
				if (navigator) Object.defineProperty(globalThis, 'navigator', navigator);
				else delete (globalThis as { navigator?: unknown }).navigator;
			}
		});

		it('constructs nothing on shutdown when the logger was never resolved', async () => {
			const flush = spyOn(PinoLogger.prototype, 'flush');
			app = await Application.testing({ modules: [LoggerModule] });
			await app.shutdown();
			app = undefined;
			expect(flush).not.toHaveBeenCalled();
			flush.mockRestore();
		});

		it('gives way to the console driver when asked', async () => {
			app = await Application.testing({ modules: [LoggerModule.with({ transport: 'console' })] });
			expect(await app.get('logger')).toBeInstanceOf(JsonConsoleLogger);
		});

		it('flushes a built logger on shutdown', async () => {
			const flush = spyOn(PinoLogger.prototype, 'flush');
			app = await Application.testing({ modules: [LoggerModule] });
			await app.get('logger');
			await app.shutdown();
			app = undefined;
			expect(flush).toHaveBeenCalled();
			flush.mockRestore();
		});
	});
});
