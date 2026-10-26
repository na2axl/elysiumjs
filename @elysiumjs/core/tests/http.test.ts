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

import type { Context } from '../src/http';
import type { ElysiaPlugin } from '../src/utils';

import { afterAll, afterEach, describe, expect, it, mock, spyOn } from 'bun:test';
import * as Elysia from 'elysia';

import * as pkg from '../src';
import { Application } from '../src/app';
import { Event } from '../src/event';
import { Http, HttpControllerScope } from '../src/http';
import { Metadata } from '../src/metadata';
import * as M from '../src/middleware';
import { ModuleContext } from '../src/module-context';
import { Service } from '../src/service';
import { nextTick, Symbols } from '../src/utils';
import { testNode } from './module-node';

describe('Http namespace', () => {
	afterAll(() => {
		mock.restore();
	});

	describe('@Http.controller decorator', () => {
		afterEach(() => {
			mock.restore();
		});

		it('should set metadata on the target class', () => {
			// Create a test class
			@Http.controller({
				path: '/test'
			})
			class TestController {}

			// Check if metadata was set correctly
			const plugin = Metadata.get(Symbols.elysiaPlugin, TestController);
			expect(plugin).toBeDefined();
			expect(typeof plugin).toBe('function');
		});

		it('should create an Elysia app with the correct prefix', async () => {
			// Create a test class
			@Http.controller({
				path: '/test'
			})
			class TestController {}

			// Get the plugin function
			const plugin = Metadata.get(Symbols.elysiaPlugin, TestController);

			const app = await plugin(testNode());

			expect(app.config.prefix).toBe('/test');
		});

		it('should register the controller in the service container with SERVER scope', async () => {
			const makeSpy = spyOn(Service, 'make');

			// Create a test class
			@Http.controller({
				path: '/test',
				scope: HttpControllerScope.SERVER
			})
			class TestController {}

			const resolveSpy = spyOn(Elysia.Elysia.prototype, 'resolve');

			// Get the plugin function
			const plugin = Metadata.get(Symbols.elysiaPlugin, TestController);

			// Call the plugin function
			await plugin(testNode());

			// Check if the controller was built once, when the plugin was created
			expect(makeSpy).toHaveBeenCalledWith(TestController);
			expect(resolveSpy).toHaveBeenCalledWith({ as: 'local' }, expect.any(Function));
		});

		it('should register the controller in the service container with REQUEST scope', async () => {
			const makeSpy = spyOn(Service, 'make');

			// Create a test class
			@Http.controller({
				path: '/test',
				scope: HttpControllerScope.REQUEST
			})
			class TestController {
				@Http.get({ path: '/' })
				get() {
					return 'test';
				}
			}

			const resolveSpy = spyOn(Elysia.Elysia.prototype, 'resolve');
			const executeMiddlewareChainSpy = spyOn(M, 'executeMiddlewareChain').mockImplementation(
				async () => undefined
			);

			// Get the plugin function
			const plugin: ElysiaPlugin = Metadata.get(Symbols.elysiaPlugin, TestController);

			// Call the plugin function
			const app = await plugin(testNode());

			// Check if the controller was registered in the service container
			expect(makeSpy).not.toHaveBeenCalledWith(TestController);
			expect(resolveSpy).toHaveBeenCalledWith({ as: 'local' }, expect.any(Function));

			// A REQUEST-scoped controller is built for each request.
			const response = await app.handle(new Request('http://localhost/test'));

			expect(await response.text()).toBe('test');
			expect(makeSpy).toHaveBeenLastCalledWith(TestController);
			expect(executeMiddlewareChainSpy).toHaveBeenCalledWith(
				[],
				expect.any(Object),
				'onBeforeHandle',
				expect.any(Object)
			);
		});

		it('should apply middlewares to the Elysia app', async () => {
			// Create middleware classes
			class TestMiddleware1 extends M.Middleware {}
			class TestMiddleware2 extends M.Middleware {}

			// Create a test class with middlewares
			@Http.controller({
				path: '/test'
			})
			class TestController {}

			// Set middlewares metadata
			Metadata.define(Symbols.middlewares, [TestMiddleware1, TestMiddleware2], TestController);

			// Get the plugin function
			const plugin = Metadata.get(Symbols.elysiaPlugin, TestController);

			const applyMiddlewaresSpy = spyOn(M, 'applyMiddlewares');

			// Call the plugin function
			const node = testNode();
			await plugin(node);

			// Check if middlewares were applied
			expect(applyMiddlewaresSpy).toHaveBeenCalledWith(
				[TestMiddleware1, TestMiddleware2],
				expect.any(Elysia.Elysia),
				node
			);
		});
	});

	describe('HTTP method decorators', () => {
		afterEach(() => {
			mock.restore();
		});

		it('should register a GET route', async () => {
			// Create a test class
			@Http.controller({
				path: '/test'
			})
			class TestController {
				@Http.get({ path: '/users' })
				getUsers() {
					return ['user1', 'user2'];
				}
			}

			await nextTick();

			// Check if metadata was set correctly
			const metadata = Metadata.get(Symbols.http, TestController);
			expect(metadata).toBeDefined();
			expect(metadata).toBeArrayOfSize(1);
			expect(metadata[0].method).toBe('GET');
			expect(metadata[0].path).toBe('/users');
		});

		it('should register a POST route', async () => {
			// Create a test class
			@Http.controller({
				path: '/test'
			})
			class TestController {
				@Http.post({ path: '/users' })
				createUser() {
					return { id: 1, name: 'User' };
				}
			}

			await nextTick();

			// Check if metadata was set correctly
			const metadata = Metadata.get(Symbols.http, TestController);
			expect(metadata).toBeDefined();
			expect(metadata).toBeArrayOfSize(1);
			expect(metadata[0].method).toBe('POST');
			expect(metadata[0].path).toBe('/users');
		});

		it('should register a PUT route', async () => {
			// Create a test class
			@Http.controller({
				path: '/test'
			})
			class TestController {
				@Http.put({ path: '/users/:id' })
				updateUser() {
					return { id: 1, name: 'Updated User' };
				}
			}

			await nextTick();

			// Check if metadata was set correctly
			const metadata = Metadata.get(Symbols.http, TestController);
			expect(metadata).toBeDefined();
			expect(metadata).toBeArrayOfSize(1);
			expect(metadata[0].method).toBe('PUT');
			expect(metadata[0].path).toBe('/users/:id');
		});

		it('should register a DELETE route', async () => {
			// Create a test class
			@Http.controller({
				path: '/test'
			})
			class TestController {
				@Http.del({ path: '/users/:id' })
				deleteUser() {
					return { success: true };
				}
			}

			await nextTick();

			// Check if metadata was set correctly
			const metadata = Metadata.get(Symbols.http, TestController);
			expect(metadata).toBeDefined();
			expect(metadata).toBeArrayOfSize(1);
			expect(metadata[0].method).toBe('DELETE');
			expect(metadata[0].path).toBe('/users/:id');
		});

		it('should register a PATCH route', async () => {
			// Create a test class
			@Http.controller({
				path: '/test'
			})
			class TestController {
				@Http.patch({ path: '/users/:id' })
				patchUser() {
					return { id: 1, name: 'Patched User' };
				}
			}

			await nextTick();

			// Check if metadata was set correctly
			const metadata = Metadata.get(Symbols.http, TestController);
			expect(metadata).toBeDefined();
			expect(metadata).toBeArrayOfSize(1);
			expect(metadata[0].method).toBe('PATCH');
			expect(metadata[0].path).toBe('/users/:id');
		});

		it('should register a HEAD route', async () => {
			// Create a test class
			@Http.controller({
				path: '/test'
			})
			class TestController {
				@Http.head({ path: '/users/:id' })
				headUser() {
					return { id: 1 };
				}
			}

			await nextTick();

			// Check if metadata was set correctly
			const metadata = Metadata.get(Symbols.http, TestController);
			expect(metadata).toBeDefined();
			expect(metadata).toBeArrayOfSize(1);
			expect(metadata[0].method).toBe('HEAD');
			expect(metadata[0].path).toBe('/users/:id');
		});

		it('should register a OPTIONS route', async () => {
			// Create a test class
			@Http.controller({
				path: '/test'
			})
			class TestController {
				@Http.options({ path: '/users/:id' })
				optionsUser() {
					return { id: 1 };
				}
			}

			await nextTick();

			// Check if metadata was set correctly
			const metadata = Metadata.get(Symbols.http, TestController);
			expect(metadata).toBeDefined();
			expect(metadata).toBeArrayOfSize(1);
			expect(metadata[0].method).toBe('OPTIONS');
			expect(metadata[0].path).toBe('/users/:id');
		});

		it('should register a TRACE route', async () => {
			// Create a test class
			@Http.controller({
				path: '/test'
			})
			class TestController {
				@Http.trace({ path: '/users/:id' })
				traceUser() {
					return { id: 1 };
				}
			}

			await nextTick();

			// Check if metadata was set correctly
			const metadata = Metadata.get(Symbols.http, TestController);
			expect(metadata).toBeDefined();
			expect(metadata).toBeArrayOfSize(1);
			expect(metadata[0].method).toBe('TRACE');
			expect(metadata[0].path).toBe('/users/:id');
		});

		it('should register a custom route', async () => {
			// Create a test class
			@Http.controller({
				path: '/test'
			})
			class TestController {
				@Http.custom({ method: 'OPTIONS', path: '/users' })
				optionsUser() {
					return { allowed: ['GET', 'POST'] };
				}
			}

			await nextTick();

			// Check if metadata was set correctly
			const metadata = Metadata.get(Symbols.http, TestController);
			expect(metadata).toBeDefined();
			expect(metadata).toBeArrayOfSize(1);
			expect(metadata[0].method).toBe('OPTIONS');
			expect(metadata[0].path).toBe('/users');
		});

		it('should register an SSE route', async () => {
			// Create a test class
			@Http.controller({
				path: '/test'
			})
			class TestController {
				@Http.sse({ path: '/events' })
				async getEvents() {
					return ['event1', 'event2'];
				}
			}

			await nextTick();

			// Check if metadata was set correctly
			const metadata = Metadata.get(Symbols.http, TestController);
			expect(metadata).toBeDefined();
			expect(metadata).toBeArrayOfSize(1);
			expect(metadata[0].method).toBe('elysium:SSE');
			expect(metadata[0].path).toBe('/events');
		});
	});

	describe('Parameter decorators', () => {
		afterEach(() => {
			mock.restore();
		});

		it('should register a body parameter', async () => {
			// Create a test class
			@Http.controller({
				path: '/test'
			})
			class TestController {
				@Http.post({ path: '/users' })
				createUser(@Http.body() body: any) {
					return body;
				}
			}

			await nextTick();

			// Check if metadata was set correctly
			const metadata = Metadata.get('http:body', TestController.prototype, 'createUser');
			expect(metadata).toBeDefined();
			expect(metadata.index).toBe(0);
		});

		it('should register a query parameter', async () => {
			// Create a test class
			@Http.controller({
				path: '/test'
			})
			class TestController {
				@Http.get({ path: '/users' })
				getUsers(@Http.query() query: any) {
					return query;
				}
			}

			await nextTick();

			// Check if metadata was set correctly
			const metadata = Metadata.get('http:query', TestController.prototype, 'getUsers');
			expect(metadata).toBeDefined();
			expect(metadata.index).toBe(0);
		});

		it('should register a path parameter', async () => {
			// Create a test class
			@Http.controller({
				path: '/test'
			})
			class TestController {
				@Http.get({ path: '/users/:id' })
				getUser(@Http.param('id') id: string) {
					return { id };
				}
			}

			await nextTick();

			// Check if metadata was set correctly
			const params = Metadata.get('http:params', TestController.prototype, 'getUser');
			expect(params).toBeDefined();
			expect(params).toBeArrayOfSize(1);
			expect(params[0].slug).toBe('id');
			expect(params[0].index).toBe(0);
		});

		it('should register a context parameter', async () => {
			// Create a test class
			@Http.controller({
				path: '/test'
			})
			class TestController {
				@Http.get({ path: '/users' })
				getUsers(@Http.context() ctx: Context) {
					return ctx;
				}
			}

			await nextTick();

			// Check if metadata was set correctly
			const metadata = Metadata.get('http:rawContext', TestController.prototype, 'getUsers');
			expect(metadata).toBeDefined();
			expect(metadata.index).toBe(0);
		});

		it('should register a custom decorator parameter', async () => {
			// Create a custom decorator
			const customDecorator = Http.decorate((c) => c.headers['x-custom-header']);

			// Create a test class
			@Http.controller({
				path: '/test'
			})
			class TestController {
				@Http.get({ path: '/users' })
				getUsers(@customDecorator() customHeader: string) {
					return { customHeader };
				}
			}

			await nextTick();

			// Check if metadata was set correctly
			const decorators = Metadata.get(
				'http:customDecorators',
				TestController.prototype,
				'getUsers'
			);
			expect(decorators).toBeDefined();
			expect(decorators).toBeArrayOfSize(1);
			expect(decorators[0].index).toBe(0);
			expect(typeof decorators[0].handler).toBe('function');
		});
	});

	describe('onRequest decorator', () => {
		afterEach(() => {
			mock.restore();
		});

		it('should register an onRequest handler', async () => {
			const handleRequestSpy = mock();

			// Create a test class
			@Http.controller({
				path: '/test',
				scope: HttpControllerScope.REQUEST
			})
			class TestController {
				@Http.onRequest()
				handleRequest(c: any) {
					handleRequestSpy(c);
					return `Request handled: ${c.path}`;
				}

				@Http.get()
				get() {
					return 'test';
				}
			}

			await nextTick();

			// Check if metadata was set correctly
			const metadata = Metadata.get('http:onRequest', TestController);
			expect(metadata).toBeDefined();
			expect(metadata.handler).toBeDefined();

			// Get the plugin function
			const plugin: ElysiaPlugin = Metadata.get(Symbols.elysiaPlugin, TestController);

			// Call the plugin function
			const app = await plugin(testNode());

			app.listen(3131);
			await app.handle(new Request('http://localhost:3131/test'));
			app.stop();

			expect(handleRequestSpy).toHaveBeenCalledTimes(1);
		});
	});

	describe('Transactional routes', () => {
		afterEach(() => {
			mock.restore();
		});

		it('should mark a controller as transactional', async () => {
			// Create a test class
			@Http.controller({
				path: '/test',
				transactional: true
			})
			class TestController {
				@Http.get({ path: '/users' })
				getUsers() {
					return ['user1', 'user2'];
				}
			}

			await nextTick();

			// Get the plugin function
			const plugin = Metadata.get(Symbols.elysiaPlugin, TestController);

			// Check if the controller is marked as transactional
			expect(plugin).toBeDefined();
		});

		it('should mark a route as transactional', async () => {
			// Create a test class
			@Http.controller({
				path: '/test'
			})
			class TestController {
				@Http.get({ path: '/users', transactional: true })
				getUsers() {
					return ['user1', 'user2'];
				}
			}

			await nextTick();

			// Check if metadata was set correctly
			const metadata = Metadata.get(Symbols.http, TestController);
			expect(metadata).toBeDefined();
			expect(metadata).toBeArrayOfSize(1);
			expect(metadata[0].transactional).toBe(true);
		});
	});

	describe('Transactional handlers', () => {
		const events: string[] = [];

		/** A `db.transaction` service exposing a fake transaction as `db:tx` while it is open. */
		const transactionService = () =>
			mock(async (callback: () => Promise<unknown>) => {
				events.push('begin');
				const store = new Map(Application.context.getStore());
				store.set('db:tx', 'TX');
				try {
					const result = await Application.context.run(store, callback);
					events.push('commit');
					return result;
				} catch (error) {
					events.push('rollback');
					throw error;
				}
			});

		const routeOf = async (controller: Function, path: string) => {
			await nextTick();
			const plugin: ElysiaPlugin = Metadata.get(Symbols.elysiaPlugin, controller);
			const app = await plugin(testNode());
			return app.routes.find((r) => r.path === path)!.handler as (c: any) => any;
		};

		const context = (controller: Function) => ({
			controller: () => new (controller as any)(),
			params: {},
			tenant: 'acme',
			set: { headers: {} }
		});

		const currentEntries = () => {
			const store = Application.context.getStore();
			return `${store?.get('tenant')}/${store?.get('db:tx')}`;
		};

		afterEach(() => {
			events.length = 0;
			Service.clear();
			mock.restore();
		});

		it('runs a transactional handler through the db.transaction service', async () => {
			expect(pkg.DATABASE_TRANSACTION_SERVICE).toBe('db.transaction');
			const service = Service.instance(pkg.DATABASE_TRANSACTION_SERVICE, transactionService());

			@Http.controller({ path: '/tx' })
			class TxController {
				@Http.get({ path: '/plain', transactional: true })
				async plain() {
					events.push(`handler:${currentEntries()}`);
					return 'done';
				}
			}

			const handler = await routeOf(TxController, '/tx/plain');
			expect(await handler(context(TxController))).toBe('done');
			expect(service).toHaveBeenCalledTimes(1);
			expect(events).toEqual(['begin', 'handler:acme/TX', 'commit']);
		});

		it('fails clearly when no db.transaction service is registered', async () => {
			@Http.controller({ path: '/tx' })
			class TxController {
				@Http.get({ path: '/missing', transactional: true })
				async missing() {
					return 'done';
				}
			}

			const handler = await routeOf(TxController, '/tx/missing');
			await expect(handler(context(TxController))).rejects.toThrow(/db\.transaction/);
		});

		it('keeps the transaction open until a transactional generator is consumed', async () => {
			Service.instance('db.transaction', transactionService());

			@Http.controller({ path: '/tx' })
			class TxController {
				@Http.get({ path: '/stream', transactional: true })
				async *stream() {
					events.push(`step1:${currentEntries()}`);
					yield 1;
					events.push(`step2:${currentEntries()}`);
					yield 2;
				}
			}

			const handler = await routeOf(TxController, '/tx/stream');
			const values: unknown[] = [];
			for await (const value of handler(context(TxController)) as AsyncGenerator) {
				events.push(`consumed:${value}`);
				values.push(value);
			}

			expect(values).toEqual([1, 2]);
			expect(events).toEqual([
				'begin',
				'step1:acme/TX',
				'consumed:1',
				'step2:acme/TX',
				'consumed:2',
				'commit'
			]);
		});

		it('rolls back the transaction of a generator that throws', async () => {
			Service.instance('db.transaction', transactionService());

			@Http.controller({ path: '/tx' })
			class TxController {
				@Http.get({ path: '/failing', transactional: true })
				async *failing() {
					yield 1;
					throw new Error('boom');
				}
			}

			const handler = await routeOf(TxController, '/tx/failing');
			const values: unknown[] = [];
			for await (const value of handler(context(TxController)) as AsyncGenerator) {
				values.push(value);
			}

			expect(values[0]).toBe(1);
			expect((values[1] as Error).message).toBe('boom');
			expect(events).toEqual(['begin', 'rollback']);
		});

		it('rolls back the transaction of a generator closed early', async () => {
			Service.instance('db.transaction', transactionService());

			@Http.controller({ path: '/tx' })
			class TxController {
				@Http.get({ path: '/early', transactional: true })
				async *early() {
					try {
						yield 1;
						yield 2;
					} finally {
						events.push('cleanup');
					}
				}
			}

			const handler = await routeOf(TxController, '/tx/early');
			const iterator = handler(context(TxController)) as AsyncGenerator;
			expect((await iterator.next()).value).toBe(1);
			await iterator.return(undefined);

			expect(events).toEqual(['begin', 'cleanup', 'rollback']);
		});

		it('rolls back when the client disconnects while the handler is waiting', async () => {
			Service.instance('db.transaction', transactionService());

			@Http.controller({ path: '/tx' })
			class TxController {
				@Http.get({ path: '/stuck', transactional: true })
				async *stuck() {
					yield 1;
					await new Promise(() => {});
				}
			}

			const handler = await routeOf(TxController, '/tx/stuck');
			const disconnect = new AbortController();
			const iterator = handler({
				...context(TxController),
				request: new Request('http://localhost/tx/stuck', { signal: disconnect.signal })
			}) as AsyncGenerator;
			expect((await iterator.next()).value).toBe(1);

			const next = iterator.next();
			await Bun.sleep(5);
			disconnect.abort();

			expect((await next).done).toBe(true);
			expect(events).toEqual(['begin', 'rollback']);
		});

		it('closes an idle generator before rolling back when the client disconnects', async () => {
			Service.instance('db.transaction', transactionService());

			@Http.controller({ path: '/tx' })
			class TxController {
				@Http.get({ path: '/idle', transactional: true })
				async *idle() {
					try {
						yield 1;
						yield 2;
					} finally {
						await Bun.sleep(5);
						events.push('cleanup');
					}
				}
			}

			const handler = await routeOf(TxController, '/tx/idle');
			const disconnect = new AbortController();
			const iterator = handler({
				...context(TxController),
				request: new Request('http://localhost/tx/idle', { signal: disconnect.signal })
			}) as AsyncGenerator;
			expect((await iterator.next()).value).toBe(1);

			disconnect.abort();
			await Bun.sleep(30);

			expect(events).toEqual(['begin', 'cleanup', 'rollback']);
			await iterator.return(undefined);
		});

		it('reports errors of a generator closed after a disconnect during a step', async () => {
			Service.instance('db.transaction', transactionService());
			const errors: unknown[] = [];
			Event.on('elysium:error', (event: { data: unknown }) => {
				errors.push(event.data);
			});
			const gate = Promise.withResolvers<void>();

			@Http.controller({ path: '/tx' })
			class TxController {
				@Http.get({ path: '/busy', transactional: true })
				async *busy() {
					yield 1;
					try {
						await gate.promise;
						yield 2;
					} finally {
						events.push('cleanup');
						throw new Error('cleanup failed');
					}
				}
			}

			const handler = await routeOf(TxController, '/tx/busy');
			const disconnect = new AbortController();
			const iterator = handler({
				...context(TxController),
				request: new Request('http://localhost/tx/busy', { signal: disconnect.signal })
			}) as AsyncGenerator;
			expect((await iterator.next()).value).toBe(1);

			const next = iterator.next();
			await Bun.sleep(5);
			disconnect.abort();
			expect((await next).done).toBe(true);
			expect(events).toEqual(['begin', 'rollback']);

			gate.resolve();
			await Bun.sleep(10);

			try {
				expect(events).toEqual(['begin', 'rollback', 'cleanup']);
				expect(errors).toHaveLength(1);
				expect((errors[0] as Error).message).toBe('cleanup failed');
			} finally {
				Event.off('elysium:error');
			}
		});

		it('exposes the request context to the body of a generator handler', async () => {
			@Http.controller({ path: '/tx' })
			class TxController {
				@Http.get({ path: '/context' })
				async *context() {
					yield Application.context.getStore()?.get('tenant');
				}
			}

			const handler = await routeOf(TxController, '/tx/context');
			const values: unknown[] = [];
			for await (const value of handler(context(TxController)) as AsyncGenerator) {
				values.push(value);
			}

			expect(values).toEqual(['acme']);
		});
	});

	describe('Integration with Elysia', () => {
		afterEach(() => {
			mock.restore();
		});

		it('should register routes with Elysia', async () => {
			// Create a test class
			@Http.controller({
				path: '/test'
			})
			class TestController {
				@Http.get({ path: '/users' })
				getUsers() {
					return ['user1', 'user2'];
				}

				@Http.post({ path: '/users' })
				createUser(@Http.body() body: any) {
					return body;
				}
			}

			// Get the plugin function
			const plugin = Metadata.get(Symbols.elysiaPlugin, TestController);

			// Create a spy on Elysia.route method
			const routeSpy = spyOn(Elysia.Elysia.prototype, 'route');

			// Call the plugin function
			await plugin(testNode());

			// Check if routes were registered
			expect(routeSpy).toHaveBeenCalledTimes(2);
			expect(routeSpy).toHaveBeenCalledWith(
				'GET',
				'/users',
				expect.any(Function),
				expect.anything()
			);
			expect(routeSpy).toHaveBeenCalledWith(
				'POST',
				'/users',
				expect.any(Function),
				expect.anything()
			);
		});

		it('should close a generator handler in the module context when iteration stops early', async () => {
			const closed: (string | undefined)[] = [];

			@Http.controller({ path: '/test' })
			class TestController {
				@Http.get({ path: '/stream' })
				async *stream() {
					try {
						yield 1;
						yield 2;
					} finally {
						closed.push(ModuleContext.current()?.id);
					}
				}
			}

			await nextTick();

			@Application.register()
			class TestApp extends Application {}
			new TestApp();

			const node = testNode();
			const plugin: ElysiaPlugin = Metadata.get(Symbols.elysiaPlugin, TestController);
			const app = await plugin(node);
			const route = app.routes.find((r) => r.path === '/test/stream')!;
			const handler = route.handler as (c: any) => AsyncGenerator;

			const iterator = handler({ controller: () => new TestController(), params: {} });
			expect((await iterator.next()).value).toBe(1);
			await iterator.return(undefined);

			expect(closed).toEqual([node.id]);
			Service.clear();
		});
	});
});
