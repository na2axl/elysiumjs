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

import type { Mock } from 'bun:test';

import { afterAll, beforeEach, describe, expect, it, jest, mock, spyOn } from 'bun:test';
import { Elysia } from 'elysia';
import { last } from 'radash';

import { Event } from '../src/event';
import { nextTick, Symbols } from '../src/utils';
import { testNode } from './module-node';
import { Wamp } from '../src/wamp';

// Mock Wampy
const mockWampy = {
	register: mock(() => Promise.resolve({ topic: 'test.rpc', requestId: '1', registrationId: '1' })),
	subscribe: mock(() =>
		Promise.resolve({
			topic: 'test.topic',
			requestId: '1',
			subscriptionId: '1',
			subscriptionKey: '1'
		})
	),
	connect: mock(() => Promise.resolve())
};

// Mock WebSocket
global.WebSocket = mock(() => ({
	protocol: 'wamp.2.json'
})) as any;

// Mock controller instance
const mockController = {
	handleRpc: mock(),
	handleSubscription: mock(),
	onOpenHandler: mock(),
	onChallengeHandler: mock(),
	onCloseHandler: mock(),
	onErrorHandler: mock(),
	onReconnectHandler: mock(),
	onReconnectSuccessHandler: mock()
};

// Mock Wampy constructor
mock.module('wampy', () => ({
	default: mock(function (...args: any[]) {
		return mockWampy;
	})
}));

describe('Wamp', () => {
	afterAll(() => {
		mock.restore();
	});

	beforeEach(() => {
		jest.restoreAllMocks();
	});

	describe('@Wamp.controller decorator', () => {
		it('should set metadata on the target class', () => {
			// Create a test class
			@Wamp.controller({
				url: 'ws://localhost:8080/ws',
				realm: 'realm1'
			})
			class TestWampController {}

			// Check if metadata was set correctly
			const plugin = Reflect.getMetadata(Symbols.elysiaPlugin, TestWampController);
			expect(plugin).toBeDefined();
			expect(typeof plugin).toBe('function');
		});

		it('should create an Elysia app', async () => {
			// Create a test class
			@Wamp.controller({
				url: 'ws://localhost:8080/ws',
				realm: 'realm1'
			})
			class TestWampController {}

			// Get the plugin function
			const plugin = Reflect.getMetadata(Symbols.elysiaPlugin, TestWampController);

			// Call the plugin function
			const app = await plugin(testNode());

			// Check if an Elysia app was created
			expect(app).toBeInstanceOf(Elysia);
		});

		it('should create a WAMP connection with the correct options', async () => {
			// Create a test class
			@Wamp.controller({
				url: 'ws://localhost:8080/ws',
				realm: 'realm1',
				autoReconnect: true,
				maxRetries: 5,
				retryInterval: 1000
			})
			class TestWampController {}

			// Get the plugin function
			const plugin = Reflect.getMetadata(Symbols.elysiaPlugin, TestWampController);

			// Call the plugin function
			await plugin(testNode());

			// Check if Wampy was called with the correct options
			// @ts-expect-error Mocking headaches
			const { default: Wampy } = await import('wampy');
			expect(Wampy).toHaveBeenCalledWith(
				'ws://localhost:8080/ws',
				expect.objectContaining({
					realm: 'realm1',
					autoReconnect: true,
					maxRetries: 5,
					retryInterval: 1000
				})
			);
		});

		it('should connect to the WAMP server when the app starts', async () => {
			// Create a test class
			@Wamp.controller({
				url: 'ws://localhost:8080/ws',
				realm: 'realm1'
			})
			class TestWampController {}

			// Get the plugin function
			const plugin = Reflect.getMetadata(Symbols.elysiaPlugin, TestWampController);

			// Call the plugin function
			const app: Elysia = await plugin(testNode());

			// Trigger the onStart event
			await app.event.start?.[0].fn(app);

			// Check if connect was called
			expect(mockWampy.connect).toHaveBeenCalled();
		});
	});

	describe('@Wamp.register decorator', () => {
		it('should register an RPC handler', async () => {
			// Create a test class
			@Wamp.controller({
				url: 'ws://localhost:8080/ws',
				realm: 'realm1'
			})
			class TestWampController {
				@Wamp.register('test.rpc')
				handleRpc(data: any) {
					return { success: true };
				}
			}

			// Get the plugin function
			const plugin = Reflect.getMetadata(Symbols.elysiaPlugin, TestWampController);

			// Call the plugin function
			const app: Elysia = await plugin(testNode());
			app.listen(3131);
			await nextTick();

			// Check if the RPC was registered
			expect(mockWampy.register).toHaveBeenCalledWith('test.rpc', expect.any(Function), undefined);

			app.stop();
		});

		it('should register an RPC handler with options', async () => {
			// Create a test class
			@Wamp.controller({
				url: 'ws://localhost:8080/ws',
				realm: 'realm1'
			})
			class TestWampController {
				@Wamp.register('test.rpc', { match: 'prefix', invoke: 'roundrobin' })
				handleRpc(data: any) {
					return { success: true };
				}
			}

			// Get the plugin function
			const plugin = Reflect.getMetadata(Symbols.elysiaPlugin, TestWampController);

			// Call the plugin function
			const app: Elysia = await plugin(testNode());
			app.listen(3131);
			await nextTick();

			// Check if the RPC was registered with options
			expect(mockWampy.register).toHaveBeenCalledWith('test.rpc', expect.any(Function), {
				match: 'prefix',
				invoke: 'roundrobin'
			});

			app.stop();
		});

		it('should set metadata on the target class', () => {
			// Create a test class
			@Wamp.controller({
				url: 'ws://localhost:8080/ws',
				realm: 'realm1'
			})
			class TestWampController {
				@Wamp.register('test.rpc')
				handleRpc(data: any) {
					return { success: true };
				}
			}

			// Check if metadata was set correctly
			const metadata = Reflect.getMetadata(Symbols.wamp, TestWampController);
			expect(metadata).toBeDefined();
			expect(metadata.registrations).toBeArrayOfSize(1);
			expect(metadata.registrations[0].topic).toBe('test.rpc');
			expect(metadata.registrations[0].handler).toBeDefined();
		});
	});

	describe('@Wamp.subscribe decorator', () => {
		it('should register a subscription handler', async () => {
			// Create a test class
			@Wamp.controller({
				url: 'ws://localhost:8080/ws',
				realm: 'realm1'
			})
			class TestWampController {
				@Wamp.subscribe('test.topic')
				handleSubscription(data: any) {
					// Handle subscription
				}
			}

			// Get the plugin function
			const plugin = Reflect.getMetadata(Symbols.elysiaPlugin, TestWampController);

			// Call the plugin function
			const app: Elysia = await plugin(testNode());
			app.listen(3131);
			await nextTick();

			// Check if the subscription was registered
			expect(mockWampy.subscribe).toHaveBeenCalledWith(
				'test.topic',
				expect.any(Function),
				undefined
			);

			app.stop();
		});

		it('should register a subscription handler with options', async () => {
			// Create a test class
			@Wamp.controller({
				url: 'ws://localhost:8080/ws',
				realm: 'realm1'
			})
			class TestWampController {
				@Wamp.subscribe('test.topic', { match: 'prefix' })
				handleSubscription(data: any) {
					// Handle subscription
				}
			}

			// Get the plugin function
			const plugin = Reflect.getMetadata(Symbols.elysiaPlugin, TestWampController);

			// Call the plugin function
			const app: Elysia = await plugin(testNode());
			app.listen(3131);
			await nextTick();

			// Check if the subscription was registered with options
			expect(mockWampy.subscribe).toHaveBeenCalledWith('test.topic', expect.any(Function), {
				match: 'prefix'
			});

			app.stop();
		});

		it('should set metadata on the target class', () => {
			// Create a test class
			@Wamp.controller({
				url: 'ws://localhost:8080/ws',
				realm: 'realm1'
			})
			class TestWampController {
				@Wamp.subscribe('test.topic')
				handleSubscription(data: any) {
					// Handle subscription
				}
			}

			// Check if metadata was set correctly
			const metadata = Reflect.getMetadata(Symbols.wamp, TestWampController);
			expect(metadata).toBeDefined();
			expect(metadata.subscriptions).toBeArrayOfSize(1);
			expect(metadata.subscriptions[0].topic).toBe('test.topic');
			expect(metadata.subscriptions[0].handler).toBeDefined();
		});
	});

	describe('Lifecycle event decorators', () => {
		it('should register onChallenge handler', async () => {
			// Create a test class
			@Wamp.controller({
				url: 'ws://localhost:8080/ws',
				realm: 'realm1',
				authid: 'test',
				authmethods: ['ticket', 'wampcra']
			})
			class TestWampController {
				@Wamp.onChallenge()
				onChallengeHandler() {
					mockController.onChallengeHandler();
				}
			}

			// Check if metadata was set correctly
			const metadata = Reflect.getMetadata(Symbols.wamp, TestWampController);
			expect(metadata).toBeDefined();
			expect(metadata.challenge).toBeDefined();
		});

		it('should register onOpen handler', async () => {
			// Create a test class
			@Wamp.controller({
				url: 'ws://localhost:8080/ws',
				realm: 'realm1'
			})
			class TestWampController {
				@Wamp.onOpen()
				onOpenHandler() {
					mockController.onOpenHandler();
				}
			}

			// Get the plugin function
			const plugin = Reflect.getMetadata(Symbols.elysiaPlugin, TestWampController);

			// Call the plugin function
			const app: Elysia = await plugin(testNode());

			// Trigger the onStart event
			await app.event.start?.[0].fn(app);

			// Check if the onOpen handler was called
			expect(mockController.onOpenHandler).toHaveBeenCalled();
		});

		it('should register onClose handler', () => {
			// Create a test class
			@Wamp.controller({
				url: 'ws://localhost:8080/ws',
				realm: 'realm1'
			})
			class TestWampController {
				@Wamp.onClose()
				onCloseHandler() {
					mockController.onCloseHandler();
				}
			}

			// Check if metadata was set correctly
			const metadata = Reflect.getMetadata(Symbols.wamp, TestWampController);
			expect(metadata).toBeDefined();
			expect(metadata.close).toBeDefined();
		});

		it('should register onError handler', () => {
			// Create a test class
			@Wamp.controller({
				url: 'ws://localhost:8080/ws',
				realm: 'realm1'
			})
			class TestWampController {
				@Wamp.onError()
				onErrorHandler() {
					mockController.onErrorHandler();
				}
			}

			// Check if metadata was set correctly
			const metadata = Reflect.getMetadata(Symbols.wamp, TestWampController);
			expect(metadata).toBeDefined();
			expect(metadata.error).toBeDefined();
		});

		it('should register onReconnect handler', () => {
			// Create a test class
			@Wamp.controller({
				url: 'ws://localhost:8080/ws',
				realm: 'realm1'
			})
			class TestWampController {
				@Wamp.onReconnect()
				onReconnectHandler() {
					mockController.onReconnectHandler();
				}
			}

			// Check if metadata was set correctly
			const metadata = Reflect.getMetadata(Symbols.wamp, TestWampController);
			expect(metadata).toBeDefined();
			expect(metadata.reconnect).toBeDefined();
		});

		it('should register onReconnectSuccess handler', () => {
			// Create a test class
			@Wamp.controller({
				url: 'ws://localhost:8080/ws',
				realm: 'realm1'
			})
			class TestWampController {
				@Wamp.onReconnectSuccess()
				onReconnectSuccessHandler() {
					mockController.onReconnectSuccessHandler();
				}
			}

			// Check if metadata was set correctly
			const metadata = Reflect.getMetadata(Symbols.wamp, TestWampController);
			expect(metadata).toBeDefined();
			expect(metadata.reconnectSuccess).toBeDefined();
		});

		it('should emit an error event when a WAMP error occurs', async () => {
			// Get the Wampy constructor arguments
			// @ts-expect-error wampy doesn't have type definitions
			const { default: Wampy } = await import('wampy');
			(Wampy as Mock<any>).mockClear();

			const emitSpy = spyOn(Event, 'emit');

			// Create a test class with an error handler
			@Wamp.controller({
				url: 'ws://localhost:8080/ws',
				realm: 'realm1'
			})
			class TestWampController {
				@Wamp.onError()
				onErrorHandler() {
					console.log('onErrorHandler !');
					mockController.onErrorHandler();
				}
			}

			// Get the plugin function
			const plugin = Reflect.getMetadata(Symbols.elysiaPlugin, TestWampController);

			// Call the plugin function
			await plugin(testNode());

			const wampyArgs: any = last((Wampy as Mock<any>).mock.calls[0]);

			// Trigger the onError callback
			wampyArgs.onError();

			// Check if the error handler was called and an event was emitted
			expect(mockController.onErrorHandler).toHaveBeenCalled();
			expect(emitSpy).toHaveBeenCalledWith('elysium:error', expect.any(Error));
		});
	});
});
