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

import type { TestingApp } from '../src/testing';

import { afterAll, afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import { Elysia } from 'elysia';

import { InvalidModuleConfigError, ServiceNotFoundError } from '../src/errors';
import { createTestingApp } from '../src/testing';
import { nextTick, Symbols } from '../src/utils';
import { Wamp, WampModule } from '../src/wamp';
import { testNode } from './module-node';

// Mock Wampy: every construction yields a fresh client
const clients: any[] = [];
const disconnects = new Map<any, ReturnType<typeof mock>>();
const WampyMock = mock(function (_url: string, _options: object) {
	const client = {
		register: mock(() =>
			Promise.resolve({ topic: 'test.rpc', requestId: '1', registrationId: '1' })
		),
		subscribe: mock(() =>
			Promise.resolve({ topic: 't', requestId: '1', subscriptionId: '1', subscriptionKey: '1' })
		),
		connect: mock(() => Promise.resolve()),
		disconnect: mock(() => Promise.resolve())
	};
	// createClient wraps client.disconnect, so keep the mock reachable.
	disconnects.set(client, client.disconnect);
	clients.push(client);
	return client;
});

mock.module('wampy', () => ({ default: WampyMock }));

// Mock WebSocket
const originalWebSocket = global.WebSocket;
global.WebSocket = mock(() => ({ protocol: 'wamp.2.json' })) as any;

afterAll(() => {
	global.WebSocket = originalWebSocket;
	mock.restore();
});

const config = {
	default: 'main',
	connections: {
		main: { url: 'ws://main:8080/ws', realm: 'realm1', maxRetries: 3 },
		other: { url: 'ws://other:8080/ws', realm: 'realm2' }
	}
};

describe('WampModule', () => {
	let app: TestingApp | undefined;

	beforeEach(() => {
		clients.length = 0;
		WampyMock.mockClear();
	});

	afterEach(async () => {
		await app?.shutdown();
		app = undefined;
	});

	it('creates no client until the first get', async () => {
		app = await createTestingApp({ modules: [WampModule.with(config)] });
		expect(WampyMock).not.toHaveBeenCalled();
		expect(Wamp.connectionExists('other')).toBe(true);
	});

	it('creates and connects the client with the connection options', async () => {
		app = await createTestingApp({ modules: [WampModule.with(config)] });
		await app.get('wamp.connection.main');
		const client = Wamp.getConnection('main');
		expect(client).toBe(clients[0]);
		expect(WampyMock).toHaveBeenCalledWith(
			'ws://main:8080/ws',
			expect.objectContaining({ realm: 'realm1', maxRetries: 3 })
		);
		expect(clients[0].connect).toHaveBeenCalled();
	});

	it('resolves the default alias to the configured connection, sharing its instance', async () => {
		app = await createTestingApp({ modules: [WampModule.with(config)] });
		await app.get('wamp.connection.default');
		expect(Wamp.getDefaultConnection()).toBe(Wamp.getConnection('main'));
		expect(Wamp.getConnection()).toBe(Wamp.getConnection('main'));
		expect(WampyMock).toHaveBeenCalledTimes(1);
	});

	it('throws ServiceNotFoundError for an unknown connection', async () => {
		app = await createTestingApp({ modules: [WampModule.with(config)] });
		expect(() => Wamp.getConnection('nope')).toThrow(ServiceNotFoundError);
		expect(Wamp.connectionExists('nope')).toBe(false);
	});

	it('disconnects only the clients that were created on shutdown', async () => {
		app = await createTestingApp({ modules: [WampModule.with(config)] });
		await app.get('wamp.connection.default');
		await app.shutdown();
		app = undefined;
		expect(clients).toHaveLength(1);
		expect(disconnects.get(clients[0])).toHaveBeenCalledTimes(1);
	});

	it('serves the sync getter before any awaited get, as the module initialises synchronously', async () => {
		app = await createTestingApp({ modules: [WampModule.with(config)] });
		expect(Wamp.getConnection('other')).toBe(Wamp.getConnection('other'));
	});

	it('defaults the default connection to "default"', async () => {
		app = await createTestingApp({
			modules: [
				WampModule.with({ connections: { default: { url: 'ws://d:8080/ws', realm: 'r' } } })
			]
		});
		await app.get('wamp.connection.default');
		expect(Wamp.getConnection()).toBe(clients[0]);
		expect(WampyMock).toHaveBeenCalledTimes(1);
	});

	it('rejects an unknown default connection', async () => {
		await expect(
			createTestingApp({
				modules: [WampModule.with({ default: 'nope', connections: config.connections })]
			})
		).rejects.toThrow(InvalidModuleConfigError);
	});

	it('rejects a default alias colliding with a connection named default', async () => {
		await expect(
			createTestingApp({
				modules: [
					WampModule.with({
						default: 'main',
						connections: { ...config.connections, default: { url: 'ws://d/ws', realm: 'r' } }
					})
				]
			})
		).rejects.toThrow(InvalidModuleConfigError);
	});

	it('disconnects every client with eager boot', async () => {
		app = await createTestingApp({ modules: [WampModule.with(config)], boot: 'eager' });
		await app.shutdown();
		app = undefined;
		expect(clients).toHaveLength(2);
		for (const client of clients) expect(disconnects.get(client)).toHaveBeenCalledTimes(1);
	});

	it('disconnects every client even if one rejects, then rethrows the error', async () => {
		app = await createTestingApp({ modules: [WampModule.with(config)], boot: 'eager' });
		disconnects.get(clients[0])!.mockImplementation(() => Promise.reject(new Error('boom')));
		const consoleError = spyOn(console, 'error').mockImplementation(() => {});
		await app.shutdown();
		app = undefined;
		// The kernel logs module destroy failures instead of throwing.
		expect(consoleError).toHaveBeenCalledWith(
			expect.stringContaining('WampModule'),
			expect.objectContaining({ message: 'boom' })
		);
		consoleError.mockRestore();
		expect(disconnects.get(clients[1])).toHaveBeenCalledTimes(1);
	});

	it('stops retrying to connect once shut down', async () => {
		const consoleError = spyOn(console, 'error').mockImplementation(() => {});
		app = await createTestingApp({
			modules: [
				WampModule.with({
					connections: {
						default: { url: 'ws://d/ws', realm: 'r', retryInterval: 20, maxRetries: 5 }
					}
				})
			]
		});
		WampyMock.mockImplementationOnce(function () {
			const client = {
				connect: mock(() => Promise.reject(new Error('down'))),
				disconnect: mock(() => Promise.resolve())
			};
			clients.push(client);
			return client;
		});
		await app.get('wamp.connection.default');
		await Bun.sleep(5);
		const attempts = clients[0].connect.mock.calls.length;
		expect(attempts).toBe(1);
		await app.shutdown();
		app = undefined;
		await Bun.sleep(60);
		expect(clients[0].connect.mock.calls.length).toBe(attempts);
		consoleError.mockRestore();
	});

	it('requires connections', async () => {
		await expect(createTestingApp({ modules: [WampModule.with({})] })).rejects.toThrow(
			/connections/
		);
	});
});

describe('Wamp controllers', () => {
	let app: TestingApp | undefined;

	beforeEach(() => {
		clients.length = 0;
		WampyMock.mockClear();
	});

	afterEach(async () => {
		await app?.shutdown();
		app = undefined;
	});

	it('registers RPCs and subscriptions on the module connection when the app starts', async () => {
		app = await createTestingApp({ modules: [WampModule.with(config)] });

		await app.get('wamp.connection.other');

		@Wamp.controller({ connection: 'other' })
		class TestWampController {
			@Wamp.register('test.rpc', { match: 'prefix' })
			public rpc() {}

			@Wamp.subscribe('test.topic')
			public topic() {}
		}

		const plugin = Reflect.getMetadata(Symbols.elysiaPlugin, TestWampController);
		const elysia: Elysia = await plugin(testNode());
		await elysia.event.start?.[0].fn(elysia as any);
		await nextTick();

		const client = Wamp.getConnection('other') as any;
		expect(client.register).toHaveBeenCalledWith('test.rpc', expect.any(Function), {
			match: 'prefix'
		});
		expect(client.subscribe).toHaveBeenCalledWith('test.topic', expect.any(Function), undefined);
	});
});
