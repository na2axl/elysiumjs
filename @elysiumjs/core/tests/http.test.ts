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

import { Application } from '../src/app';
import { Http, HttpControllerScope } from '../src/http';
import { ModuleContext } from '../src/module-context';
import * as M from '../src/middleware';
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
			const plugin = Reflect.getMetadata(Symbols.elysiaPlugin, TestController);
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
			const plugin = Reflect.getMetadata(Symbols.elysiaPlugin, TestController);

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
			const plugin = Reflect.getMetadata(Symbols.elysiaPlugin, TestController);

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
			const plugin: ElysiaPlugin = Reflect.getMetadata(Symbols.elysiaPlugin, TestController);

			// Call the plugin function
			const app = await plugin(testNode());

			// Check if the controller was registered in the service container
			expect(makeSpy).not.toHaveBeenCalledWith(TestController);
			expect(resolveSpy).toHaveBeenCalledWith({ as: 'local' }, expect.any(Function));

			// TODO: Properly mock Application.context
			// app.listen(3131);
			// await app.handle(new Request('http://localhost:3131/test'));
			// app.stop();

			// expect(makeSpy).toHaveBeenLastCalledWith(TestController);
			// expect(executeMiddlewareChainSpy).toHaveBeenCalledWith(
			// 	[],
			// 	expect.any(Object),
			// 	'onBeforeHandle'
			// );
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
			Reflect.defineMetadata(
				Symbols.middlewares,
				[TestMiddleware1, TestMiddleware2],
				TestController
			);

			// Get the plugin function
			const plugin = Reflect.getMetadata(Symbols.elysiaPlugin, TestController);

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
			const metadata = Reflect.getMetadata(Symbols.http, TestController);
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
			const metadata = Reflect.getMetadata(Symbols.http, TestController);
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
			const metadata = Reflect.getMetadata(Symbols.http, TestController);
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
			const metadata = Reflect.getMetadata(Symbols.http, TestController);
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
			const metadata = Reflect.getMetadata(Symbols.http, TestController);
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
			const metadata = Reflect.getMetadata(Symbols.http, TestController);
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
			const metadata = Reflect.getMetadata(Symbols.http, TestController);
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
			const metadata = Reflect.getMetadata(Symbols.http, TestController);
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
			const metadata = Reflect.getMetadata(Symbols.http, TestController);
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
			const metadata = Reflect.getMetadata(Symbols.http, TestController);
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
			const metadata = Reflect.getMetadata('http:body', TestController.prototype, 'createUser');
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
			const metadata = Reflect.getMetadata('http:query', TestController.prototype, 'getUsers');
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
			const params = Reflect.getMetadata('http:params', TestController.prototype, 'getUser');
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
			const metadata = Reflect.getMetadata('http:rawContext', TestController.prototype, 'getUsers');
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
			const decorators = Reflect.getMetadata(
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
			const metadata = Reflect.getMetadata('http:onRequest', TestController);
			expect(metadata).toBeDefined();
			expect(metadata.handler).toBeDefined();

			// Get the plugin function
			const plugin: ElysiaPlugin = Reflect.getMetadata(Symbols.elysiaPlugin, TestController);

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
			const plugin = Reflect.getMetadata(Symbols.elysiaPlugin, TestController);

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
			const metadata = Reflect.getMetadata(Symbols.http, TestController);
			expect(metadata).toBeDefined();
			expect(metadata).toBeArrayOfSize(1);
			expect(metadata[0].transactional).toBe(true);
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
			const plugin = Reflect.getMetadata(Symbols.elysiaPlugin, TestController);

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
			const plugin: ElysiaPlugin = Reflect.getMetadata(Symbols.elysiaPlugin, TestController);
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
