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

import { ConsoleLogger, LOGGER_SERVICE, Service } from '@elysiumjs/core';
import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test';

import { Logged } from '../src/decorators/logged';

describe('@Logged decorator', () => {
	it('should call the original method and return its result', async () => {
		class MyService {
			@Logged()
			async greet(name: string): Promise<string> {
				return `Hello, ${name}`;
			}
		}

		const service = new MyService();
		const result = await service.greet('World');
		expect(result).toBe('Hello, World');
	});

	it('should re-throw errors from the original method', async () => {
		class MyService {
			@Logged()
			async failingMethod(): Promise<void> {
				throw new Error('Test error');
			}
		}

		const service = new MyService();
		await expect(service.failingMethod()).rejects.toThrow('Test error');
	});

	it('should log args when includeArgs is true', async () => {
		const debugMock = mock((_msg: string, _ctx?: Record<string, unknown>) => {});
		const errorMock = mock((_msg: string, _ctx?: Record<string, unknown>) => {});

		class MyService {
			logger = {
				trace: mock((_msg: string, _ctx?: Record<string, unknown>) => {}),
				debug: debugMock,
				info: mock((_msg: string, _ctx?: Record<string, unknown>) => {}),
				warn: mock((_msg: string, _ctx?: Record<string, unknown>) => {}),
				error: errorMock,
				fatal: mock((_msg: string, _ctx?: Record<string, unknown>) => {})
			};

			@Logged({ includeArgs: true })
			async doWork(data: string): Promise<string> {
				return data.toUpperCase();
			}
		}

		const service = new MyService();
		await service.doWork('test');

		expect(debugMock).toHaveBeenCalled();
		const call = debugMock.mock.calls[0];
		expect(call[0]).toContain('MyService.doWork');
		expect(call[0]).toContain('Entry');
		expect(call[1]).toEqual({ args: ['test'] });
	});

	it('should log result when includeResult is true', async () => {
		const debugMock = mock((_msg: string, _ctx: Record<string, unknown>) => {});

		class MyService {
			logger = {
				trace: mock(() => {}),
				debug: debugMock,
				info: mock(() => {}),
				warn: mock(() => {}),
				error: mock(() => {}),
				fatal: mock(() => {})
			};

			@Logged({ includeResult: true })
			async getValue(): Promise<number> {
				return 42;
			}
		}

		const service = new MyService();
		await service.getValue();

		expect(debugMock).toHaveBeenCalled();
		const exitCall = debugMock.mock.calls.find(
			(c: any[]) => typeof c[0] === 'string' && c[0].includes('Exit')
		);
		expect(exitCall).toBeDefined();
		expect(exitCall![1].result).toBe(42);
	});

	it('should log timing when includeTiming is true', async () => {
		const debugMock = mock((_msg: string, _ctx: Record<string, unknown>) => {});

		class MyService {
			logger = {
				trace: mock(() => {}),
				debug: debugMock,
				info: mock(() => {}),
				warn: mock(() => {}),
				error: mock(() => {}),
				fatal: mock(() => {})
			};

			@Logged({ includeTiming: true })
			async quickMethod(): Promise<void> {}
		}

		const service = new MyService();
		await service.quickMethod();

		expect(debugMock).toHaveBeenCalled();
		const exitCall = debugMock.mock.calls.find(
			(c: any[]) => typeof c[0] === 'string' && c[0].includes('Exit')
		);
		expect(exitCall).toBeDefined();
		expect(exitCall![1].duration).toMatch(/\d+ms/);
	});

	it('should use custom log level', async () => {
		const infoMock = mock(() => {});

		class MyService {
			logger = {
				trace: mock(() => {}),
				debug: mock(() => {}),
				info: infoMock,
				warn: mock(() => {}),
				error: mock(() => {}),
				fatal: mock(() => {})
			};

			@Logged({ level: 'info', includeResult: true })
			async getInfo(): Promise<string> {
				return 'data';
			}
		}

		const service = new MyService();
		await service.getInfo();

		expect(infoMock).toHaveBeenCalled();
		const exitCall = infoMock.mock.calls.find(
			(c: any[]) => typeof c[0] === 'string' && c[0].includes('Exit')
		);
		expect(exitCall).toBeDefined();
	});

	it('should log errors with duration', async () => {
		const thrown = new Error('fail');
		const errorMock = mock((_msg: string, _ctx: Record<string, unknown>) => {});

		class MyService {
			logger = {
				trace: mock(() => {}),
				debug: mock(() => {}),
				info: mock(() => {}),
				warn: mock(() => {}),
				error: errorMock,
				fatal: mock(() => {})
			};

			@Logged()
			async failMethod(): Promise<void> {
				throw thrown;
			}
		}

		const service = new MyService();
		try {
			await service.failMethod();
		} catch {
			// expected
		}

		expect(errorMock).toHaveBeenCalled();
		const call = errorMock.mock.calls[0];
		expect(call[0]).toContain('Error');
		expect(call[1].error).toBe(thrown);
		expect(call[1].duration).toMatch(/\d+ms/);
	});

	describe('without a logger property', () => {
		afterEach(() => {
			if (Service.exists(LOGGER_SERVICE)) Service.remove(LOGGER_SERVICE);
		});

		it('falls back to a ConsoleLogger without a logger service', async () => {
			const consoleDebug = spyOn(console, 'debug').mockImplementation(() => {});
			try {
				class MyService {
					@Logged({ includeArgs: true })
					async doWork(data: string): Promise<string> {
						return data;
					}
				}

				await new MyService().doWork('x');
				expect(consoleDebug).toHaveBeenCalledWith('[DEBUG] [MyService.doWork] Entry', {
					args: ['x']
				});
			} finally {
				consoleDebug.mockRestore();
			}
		});

		it('resolves the logger service at call time', async () => {
			class MyService {
				@Logged({ includeArgs: true })
				async doWork(data: string): Promise<string> {
					return data;
				}
			}

			const logger = new ConsoleLogger();
			const debugSpy = spyOn(logger, 'debug').mockImplementation(() => {});
			Service.instance(LOGGER_SERVICE, logger);

			await new MyService().doWork('x');
			expect(debugSpy).toHaveBeenCalledWith('[MyService.doWork] Entry', { args: ['x'] });
		});
	});

	it('should handle non-Error throws', async () => {
		const errorMock = mock((_msg: string, _ctx: Record<string, unknown>) => {});

		class MyService {
			logger = {
				trace: mock(() => {}),
				debug: mock(() => {}),
				info: mock(() => {}),
				warn: mock(() => {}),
				error: errorMock,
				fatal: mock(() => {})
			};

			@Logged()
			async throwString(): Promise<void> {
				throw 'string error';
			}
		}

		const service = new MyService();
		try {
			await service.throwString();
		} catch {
			// expected
		}

		expect(errorMock).toHaveBeenCalled();
		const call = errorMock.mock.calls[0];
		expect(call[1].error).toBe('string error');
	});
});
