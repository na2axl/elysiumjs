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

import type { Context, Route } from '../src/http';
import type { LoggerInterface } from '../src/logger';

import { afterAll, afterEach, beforeEach, describe, expect, it, jest, mock, spyOn } from 'bun:test';
import { Elysia } from 'elysia';

import { Application } from '../src/app';
import { ConsoleLogger, LOGGER_SERVICE } from '../src/logger';
import { Metadata } from '../src/metadata';
import * as M from '../src/middleware';
import { ModuleContext } from '../src/module-context';
import { Service } from '../src/service';
import { Symbols } from '../src/utils';
import { testNode } from './module-node';

// Spy on the real store: mocking '../src/app' would leak into the test files run after this one.
const mockRun = spyOn(Application.context, 'run');

describe('Middleware', () => {
	// Create test middleware classes
	class TestMiddleware1 extends M.Middleware {
		public onBeforeHandle = mock((_ctx: Context) => {});
		public onAfterHandle = mock((_ctx: Context) => {});
		public onAfterResponse = mock((_ctx: Context) => {});
	}

	class TestMiddleware2 extends M.Middleware {
		public onBeforeHandle = mock((_ctx: Context) => {});
		public onAfterHandle = mock((_ctx: Context) => {});
		public onAfterResponse = mock((_ctx: Context) => {});
	}

	// Create a mock context
	const mockContext = {
		tenant: 'test-tenant'
	} as unknown as Context;

	beforeEach(() => {
		jest.clearAllMocks();
	});

	afterAll(() => {
		mock.restore();
	});

	describe('Middleware.register', () => {
		it('should register middlewares on a class', () => {
			// Create a test class
			@M.Middleware.register(TestMiddleware1, TestMiddleware2)
			class TestController {}

			// Check if metadata was set correctly
			const middlewares = Metadata.get(Symbols.middlewares, TestController);
			expect(middlewares).toBeDefined();
			expect(middlewares).toBeArrayOfSize(2);
			expect(middlewares).toContain(TestMiddleware1);
			expect(middlewares).toContain(TestMiddleware2);
		});

		it('should register middlewares on a method', () => {
			// Create a test class with a decorated method
			class TestController {
				@M.Middleware.register(TestMiddleware1, TestMiddleware2)
				testMethod() {}
			}

			// Check if metadata was set correctly
			const middlewares = Metadata.get(
				Symbols.middlewares,
				TestController.prototype,
				'testMethod'
			);
			expect(middlewares).toBeDefined();
			expect(middlewares).toBeArrayOfSize(2);
			expect(middlewares).toContain(TestMiddleware1);
			expect(middlewares).toContain(TestMiddleware2);
		});

		it('should append middlewares to existing ones on a class', () => {
			// Create a test class with existing middlewares
			class TestController {}
			Metadata.define(Symbols.middlewares, [TestMiddleware1], TestController);

			// Apply the decorator
			M.Middleware.register(TestMiddleware2)(TestController);

			// Check if metadata was updated correctly
			const middlewares = Metadata.get(Symbols.middlewares, TestController);
			expect(middlewares).toBeDefined();
			expect(middlewares).toBeArrayOfSize(2);
			expect(middlewares).toContain(TestMiddleware1);
			expect(middlewares).toContain(TestMiddleware2);
		});

		it('should append middlewares to existing ones on a method', () => {
			// Create a test class with a method that has existing middlewares
			class TestController {
				testMethod() {}
			}
			Metadata.define(
				Symbols.middlewares,
				[TestMiddleware1],
				TestController.prototype,
				'testMethod'
			);

			// Apply the decorator
			M.Middleware.register(TestMiddleware2)(TestController.prototype, 'testMethod', {
				value: TestController.prototype.testMethod,
				writable: true,
				enumerable: false,
				configurable: true
			});

			// Check if metadata was updated correctly
			const middlewares = Metadata.get(
				Symbols.middlewares,
				TestController.prototype,
				'testMethod'
			);
			expect(middlewares).toBeDefined();
			expect(middlewares).toBeArrayOfSize(2);
			expect(middlewares).toContain(TestMiddleware1);
			expect(middlewares).toContain(TestMiddleware2);
		});
	});

	describe('Middleware.guards', () => {
		it('should correctly apply guards to a middleware class', () => {
			// Create a test middleware class
			class TestGuardedMiddleware extends M.Middleware {}

			// Apply guards to the middleware class
			const guards = ['auth', 'admin'];
			const GuardedMiddleware = M.Middleware.guards.call(TestGuardedMiddleware, guards);

			// Create an instance of the guarded middleware
			const middleware = new GuardedMiddleware();

			// Check if the guards were correctly applied
			expect(middleware.guards).toBeDefined();
			expect(middleware.guards).toBeArrayOfSize(2);
			expect(middleware.guards).toEqual(guards);

			// Verify that the guarded middleware extends the original one
			expect(middleware).toBeInstanceOf(TestGuardedMiddleware);

			// Verify the metadata was set correctly
			const metadataGuards = Metadata.get(Symbols.middlewareGuards, middleware.constructor);
			expect(metadataGuards).toEqual(guards);
		});

		it('should return an empty array when no guards are defined for a middleware', () => {
			// Create a middleware instance without defined guards
			class PlainMiddleware extends M.Middleware {}
			const middleware = new PlainMiddleware();

			// Check if guards returns an empty array when no guards are defined
			expect(middleware.guards).toBeDefined();
			expect(middleware.guards).toBeArrayOfSize(0);
			expect(middleware.guards).toEqual([]);

			// Verify that metadata for middleware guards doesn't exist
			const metadataGuards = Metadata.get(Symbols.middlewareGuards, middleware.constructor);
			expect(metadataGuards).toBeUndefined();
		});

		it('should properly inherit guards from parent middleware class', () => {
			// Create a base middleware class with guards
			class BaseMiddleware extends M.Middleware {}
			const baseGuards = ['auth', 'user'];
			const GuardedBaseMiddleware = M.Middleware.guards.call(BaseMiddleware, baseGuards);

			// Create a child middleware that extends the guarded base middleware
			class ChildMiddleware extends GuardedBaseMiddleware {}

			// Create another middleware with additional guards
			const childGuards = ['admin'];
			const GuardedChildMiddleware = M.Middleware.guards.call(ChildMiddleware, childGuards);

			// Create instances
			const baseMiddleware = new GuardedBaseMiddleware();
			const childMiddleware = new ChildMiddleware();
			const guardedChildMiddleware = new GuardedChildMiddleware();

			// Verify base middleware has the correct guards
			expect(baseMiddleware.guards).toEqual(baseGuards);

			// Verify child middleware inherits guards from parent
			expect(childMiddleware.guards).toEqual(baseGuards);

			// Verify that applying additional guards overwrites the inherited ones
			expect(guardedChildMiddleware.guards).toEqual(childGuards);

			// Verify the inheritance chain is maintained
			expect(baseMiddleware).toBeInstanceOf(BaseMiddleware);
			expect(childMiddleware).toBeInstanceOf(BaseMiddleware);
			expect(childMiddleware).toBeInstanceOf(GuardedBaseMiddleware);
			expect(guardedChildMiddleware).toBeInstanceOf(ChildMiddleware);
			expect(guardedChildMiddleware).toBeInstanceOf(GuardedBaseMiddleware);
			expect(guardedChildMiddleware).toBeInstanceOf(BaseMiddleware);
		});
	});

	describe('executeMiddlewareChain', () => {
		it('should execute each middleware in the chain', async () => {
			// Create middleware instances
			const middleware1 = new TestMiddleware1();
			const middleware2 = new TestMiddleware2();

			// Execute the middleware chain
			const result = await M.executeMiddlewareChain(
				[middleware1, middleware2],
				mockContext,
				'onBeforeHandle'
			);

			// Check if Application.context.run was called with the correct parameters
			expect(mockRun).toHaveBeenCalledWith(expect.any(Map), expect.any(Function));

			// Check if each middleware's method was called with the context
			expect(middleware1.onBeforeHandle).toHaveBeenCalledWith(mockContext);
			expect(middleware2.onBeforeHandle).toHaveBeenCalledWith(mockContext);

			// No value should be returned
			expect(result).toBeUndefined();
		});

		it('should stop the chain if a middleware returns a value', async () => {
			// Create middleware instances
			const middleware1 = new TestMiddleware1();
			const middleware2 = new TestMiddleware2();

			// Make the first middleware return a value
			middleware1.onBeforeHandle = mock((_ctx: Context) => 'stop');

			// Execute the middleware chain
			const result = await M.executeMiddlewareChain(
				[middleware1, middleware2],
				mockContext,
				'onBeforeHandle'
			);

			// Check if the chain stopped and returned the value
			expect(result).toBe('stop');
			expect(middleware1.onBeforeHandle).toHaveBeenCalledWith(mockContext);
			expect(middleware2.onBeforeHandle).not.toHaveBeenCalled();
		});

		it('should stop the chain and propagate errors', async () => {
			// Create middleware instances
			const middleware1 = new TestMiddleware1();
			const middleware2 = new TestMiddleware2();

			// Make the first middleware throw an error
			const error = new Error('Test error');
			middleware1.onBeforeHandle = mock((_ctx: Context) => {
				throw error;
			});

			// Execute the middleware chain and expect it to throw
			await expect(
				M.executeMiddlewareChain([middleware1, middleware2], mockContext, 'onBeforeHandle')
			).rejects.toThrow(error);

			// Check if only the first middleware was called
			expect(middleware1.onBeforeHandle).toHaveBeenCalledWith(mockContext);
			expect(middleware2.onBeforeHandle).not.toHaveBeenCalled();
		});
	});

	describe('applyMiddlewares', () => {
		const hooks = ['onRequest', 'onTransform', 'onBeforeHandle', 'onAfterHandle', 'onAfterResponse'];

		it('should build the middlewares in the module context and register the scoped hooks', () => {
			const plugin = Object.fromEntries(hooks.map((h) => [h, mock()])) as unknown as Elysia;
			const node = testNode();
			const seen: unknown[] = [];
			const makeSpy = spyOn(Service, 'make').mockImplementation(((cls: any) => {
				seen.push(ModuleContext.current());
				return new cls();
			}) as never);

			M.applyMiddlewares([TestMiddleware1, TestMiddleware2], plugin as never, node);

			expect(makeSpy).toHaveBeenCalledWith(TestMiddleware1);
			expect(makeSpy).toHaveBeenCalledWith(TestMiddleware2);
			expect(seen).toEqual([node, node]);
			for (const hook of hooks.filter((h) => h !== 'onRequest')) {
				expect((plugin as any)[hook]).toHaveBeenCalled();
			}
			// Elysia would run an onRequest hook on every request of the app.
			expect((plugin as any).onRequest).not.toHaveBeenCalled();
		});

		it('should run the onRequest chain before the onTransform chain of a module', async () => {
			const callbacks: Record<string, (ctx: Context) => Promise<any>> = {};
			const plugin = Object.fromEntries(
				hooks.map((h) => [h, mock((cb) => void (callbacks[h] = cb))])
			) as unknown as Elysia;
			const calls: string[] = [];

			class OrderMiddleware extends M.Middleware {
				public onRequest() {
					calls.push('onRequest');
				}
				public onTransform() {
					calls.push('onTransform');
				}
			}

			class RejectMiddleware extends M.Middleware {
				public onRequest() {
					return 'rejected';
				}
				public onTransform() {
					calls.push('rejected onTransform');
				}
			}

			M.applyMiddlewares([OrderMiddleware], plugin as never, testNode());
			await callbacks.onTransform(mockContext);
			expect(calls).toEqual(['onRequest', 'onTransform']);

			M.applyMiddlewares([RejectMiddleware], plugin as never, testNode());
			const status = mock((code: number, body: unknown) => ({ code, body }));
			expect(await callbacks.onTransform({ ...mockContext, status } as never)).toEqual({
				code: 200,
				body: 'rejected'
			});
			expect(calls).toEqual(['onRequest', 'onTransform']);
		});

		it('should build middlewares without a module context for application middlewares', () => {
			const plugin = Object.fromEntries(hooks.map((h) => [h, mock()])) as unknown as Elysia;
			const seen: unknown[] = [];
			spyOn(Service, 'make').mockImplementation(((cls: any) => {
				seen.push(ModuleContext.current());
				return new cls();
			}) as never);

			M.applyMiddlewares([TestMiddleware1], plugin as never, null);

			expect(seen).toEqual([undefined]);
		});

		it('should run each hook chain in the module context', async () => {
			const callbacks: Record<string, (ctx: Context) => Promise<any>> = {};
			const plugin = Object.fromEntries(
				hooks.map((h) => [h, mock((cb) => void (callbacks[h] = cb))])
			) as unknown as Elysia;
			const node = testNode();
			const seen: unknown[] = [];

			class ProbeMiddleware extends M.Middleware {
				public onBeforeHandle() {
					seen.push(ModuleContext.current());
				}
			}

			M.applyMiddlewares([ProbeMiddleware], plugin as never, node);
			await callbacks.onBeforeHandle(mockContext);

			expect(seen).toEqual([node]);
		});
	});

	describe('Middleware lifecycle hooks', () => {
		it('should have default empty implementations for lifecycle hooks', () => {
			// Create a middleware instance
			class EmptyMiddleware extends M.Middleware {}
			const middleware = new EmptyMiddleware();

			// Check if the lifecycle hooks exist and return undefined
			expect(middleware.onBeforeHandle(mockContext)).toBeUndefined();
			expect(middleware.onAfterHandle(mockContext)).toBeUndefined();
			expect(middleware.onAfterResponse(mockContext)).toBeUndefined();
		});

		it('should allow overriding lifecycle hooks', () => {
			// Create a middleware with custom implementations
			class CustomMiddleware extends M.Middleware {
				public onBeforeHandle(_ctx: Context): string {
					return 'before';
				}

				public onAfterHandle(_ctx: Context): string {
					return 'after';
				}

				public onAfterResponse(_ctx: Context): string {
					return 'response';
				}
			}

			const middleware = new CustomMiddleware();

			// Check if the custom implementations are used
			expect(middleware.onBeforeHandle(mockContext)).toBe('before');
			expect(middleware.onAfterHandle(mockContext)).toBe('after');
			expect(middleware.onAfterResponse(mockContext)).toBe('response');
		});
	});

	describe('Middleware.logger', () => {
		class LoggingMiddleware extends M.Middleware {
			public get log(): LoggerInterface {
				return this.logger;
			}
		}

		afterEach(() => {
			if (Service.exists(LOGGER_SERVICE)) Service.remove(LOGGER_SERVICE);
		});

		it('falls back to a ConsoleLogger without a logger service', () => {
			const consoleInfo = spyOn(console, 'info').mockImplementation(() => {});
			try {
				const logger = new LoggingMiddleware().log;
				expect(logger).toBeInstanceOf(ConsoleLogger);

				logger.info('hello');
				expect(consoleInfo).toHaveBeenCalledWith('[INFO] hello', {
					middleware: 'LoggingMiddleware'
				});
			} finally {
				consoleInfo.mockRestore();
			}
		});

		it('uses a child of the logger service with the middleware name', () => {
			const base = new ConsoleLogger();
			const child = new ConsoleLogger();
			const childSpy = spyOn(base, 'child').mockReturnValue(child);
			Service.instance(LOGGER_SERVICE, base);

			expect(new LoggingMiddleware().log).toBe(child);
			expect(childSpy).toHaveBeenCalledWith({ middleware: 'LoggingMiddleware' });
		});
	});
});
