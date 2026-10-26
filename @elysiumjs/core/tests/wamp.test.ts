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
import { Event } from '../src/event';
import { ConsoleLogger, LOGGER_SERVICE } from '../src/logger';
import { Metadata } from '../src/metadata';
import { Service } from '../src/service';
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

/** Registers a silent logger as the `logger` service, removed after each test. */
const fakeLogger = () => {
	const logger = new ConsoleLogger();
	const spies = {
		debug: spyOn(logger, 'debug').mockImplementation(() => {}),
		info: spyOn(logger, 'info').mockImplementation(() => {}),
		warn: spyOn(logger, 'warn').mockImplementation(() => {}),
		error: spyOn(logger, 'error').mockImplementation(() => {})
	};
	Service.instance(LOGGER_SERVICE, logger);
	return spies;
};

afterEach(() => {
	if (Service.exists(LOGGER_SERVICE)) Service.remove(LOGGER_SERVICE);
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
		const logger = fakeLogger();
		await app.shutdown();
		app = undefined;
		// The kernel logs module destroy failures instead of throwing.
		expect(logger.error).toHaveBeenCalledWith('Error while destroying', {
			target: expect.stringContaining('WampModule'),
			error: expect.objectContaining({ message: 'boom' })
		});
		expect(disconnects.get(clients[1])).toHaveBeenCalledTimes(1);
	});

	it('logs a failed connection attempt as a warning before retrying', async () => {
		app = await createTestingApp({
			modules: [
				WampModule.with({
					connections: {
						default: { url: 'ws://d/ws', realm: 'r', retryInterval: 1000, maxRetries: 5 }
					}
				})
			]
		});
		const logger = fakeLogger();
		const error = new Error('down');
		WampyMock.mockImplementationOnce(function () {
			const client = {
				connect: mock(() => Promise.reject(error)),
				disconnect: mock(() => Promise.resolve())
			};
			clients.push(client);
			return client;
		});
		await app.get('wamp.connection.default');
		await Bun.sleep(0);

		expect(logger.warn).toHaveBeenCalledWith('Failed to connect to WAMP server, retrying', {
			connection: 'default',
			attempt: 1,
			maxRetries: 5,
			error
		});
		expect(logger.error).not.toHaveBeenCalled();
	});

	it('logs an error and reports an app error once the retries are exhausted', async () => {
		const errors: unknown[] = [];
		Event.on('elysium:error', (e) => {
			errors.push(e.data);
		});
		app = await createTestingApp({
			modules: [
				WampModule.with({
					connections: {
						default: { url: 'ws://d/ws', realm: 'r', retryInterval: 1, maxRetries: 1 }
					}
				})
			]
		});
		const logger = fakeLogger();
		const error = new Error('down');
		WampyMock.mockImplementationOnce(function () {
			const client = {
				connect: mock(() => Promise.reject(error)),
				disconnect: mock(() => Promise.resolve())
			};
			clients.push(client);
			return client;
		});
		try {
			await app.get('wamp.connection.default');
			await Bun.sleep(20);

			expect(clients[0].connect).toHaveBeenCalledTimes(2);
			expect(logger.warn).toHaveBeenCalledTimes(1);
			expect(logger.error).toHaveBeenCalledWith('Failed to connect to WAMP server, giving up', {
				connection: 'default',
				attempts: 2,
				maxRetries: 1,
				error
			});
			expect(errors).toContainEqual(
				new Error('Failed to establish WAMP connection default after 2 attempts')
			);
		} finally {
			Event.off('elysium:error');
		}
	});

	it('reports wampy errors as app errors naming the connection and url', async () => {
		const errors: Error[] = [];
		Event.on('elysium:error', (e) => {
			errors.push(e.data as Error);
		});
		const onError = mock();
		app = await createTestingApp({
			modules: [
				WampModule.with({
					default: 'main',
					connections: { main: { url: 'ws://main/ws', realm: 'r', onError } }
				})
			]
		});
		try {
			await app.get('wamp.connection.main');
			const wampyError = new Error('protocol violation');
			(WampyMock.mock.calls[0]![1] as any).onError(wampyError);

			expect(onError).toHaveBeenCalledWith(wampyError);
			expect(errors).toHaveLength(1);
			expect(errors[0]!.message).toBe(
				'An error occurred in WAMP connection main (ws://main/ws): protocol violation'
			);
			expect(errors[0]!.cause).toBe(wampyError);
		} finally {
			Event.off('elysium:error');
		}
	});

	it('stops retrying to connect once shut down', async () => {
		app = await createTestingApp({
			modules: [
				WampModule.with({
					connections: {
						default: { url: 'ws://d/ws', realm: 'r', retryInterval: 20, maxRetries: 5 }
					}
				})
			]
		});
		fakeLogger();
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
	});

	it('calls onOpen once connected, without passing it to wampy', async () => {
		const onOpen = mock();
		app = await createTestingApp({
			modules: [
				WampModule.with({ connections: { default: { url: 'ws://d/ws', realm: 'r', onOpen } } })
			]
		});
		await app.get('wamp.connection.default');
		await Bun.sleep(0);

		expect(onOpen).toHaveBeenCalledTimes(1);
		expect(WampyMock.mock.calls[0]![1]).not.toHaveProperty('onOpen');
	});

	it('reports a failing onOpen as an app error instead of throwing', async () => {
		const errors: unknown[] = [];
		Event.on('elysium:error', (e) => {
			errors.push(e.data);
		});
		const onOpen = mock(async () => {
			throw new Error('open handler failed');
		});
		app = await createTestingApp({
			modules: [
				WampModule.with({ connections: { default: { url: 'ws://d/ws', realm: 'r', onOpen } } })
			]
		});
		await app.get('wamp.connection.default');
		await Bun.sleep(0);

		expect(onOpen).toHaveBeenCalledTimes(1);
		expect(errors).toContainEqual(new Error('open handler failed'));
		Event.off('elysium:error');
	});

	it('does not call onOpen when shut down while connecting', async () => {
		const onOpen = mock();
		let connected!: () => void;
		WampyMock.mockImplementationOnce(function () {
			const client = {
				connect: mock(() => new Promise<void>((resolve) => (connected = resolve))),
				disconnect: mock(() => Promise.resolve())
			};
			clients.push(client);
			return client;
		});
		app = await createTestingApp({
			modules: [
				WampModule.with({ connections: { default: { url: 'ws://d/ws', realm: 'r', onOpen } } })
			]
		});
		await app.get('wamp.connection.default');
		await app.shutdown();
		app = undefined;
		connected();
		await Bun.sleep(0);

		expect(onOpen).not.toHaveBeenCalled();
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

		const plugin = Metadata.get(Symbols.elysiaPlugin, TestWampController);
		const elysia: Elysia = await plugin(testNode());
		await elysia.event.start?.[0].fn(elysia as any);
		await nextTick();

		const client = Wamp.getConnection('other') as any;
		expect(client.register).toHaveBeenCalledWith('test.rpc', expect.any(Function), {
			match: 'prefix'
		});
		expect(client.subscribe).toHaveBeenCalledWith('test.topic', expect.any(Function), undefined);
	});

	/** Starts a controller with one RPC and one subscription on the `other` connection. */
	const startController = async () => {
		@Wamp.controller({ connection: 'other' })
		class TestWampController {
			@Wamp.register('test.rpc')
			public rpc() {}

			@Wamp.subscribe('test.topic')
			public topic() {}
		}

		const plugin = Metadata.get(Symbols.elysiaPlugin, TestWampController);
		const elysia: Elysia = await plugin(testNode());
		await elysia.event.start?.[0].fn(elysia as any);
		await nextTick();
	};

	it('logs the registrations and subscriptions', async () => {
		app = await createTestingApp({ modules: [WampModule.with(config)] });
		const logger = fakeLogger();
		await app.get('wamp.connection.other');

		await startController();

		expect(logger.info).toHaveBeenCalledWith('Registered WAMP RPC', {
			connection: 'other',
			topic: 'test.rpc',
			registrationId: '1'
		});
		expect(logger.info).toHaveBeenCalledWith('Subscribed to WAMP topic', {
			connection: 'other',
			topic: 'test.topic',
			subscriptionId: '1'
		});
	});

	it('logs and reports failed registrations and subscriptions as app errors', async () => {
		const errors: Error[] = [];
		Event.on('elysium:error', (e) => {
			errors.push(e.data as Error);
		});
		app = await createTestingApp({ modules: [WampModule.with(config)] });
		const logger = fakeLogger();
		const client = (await app.get('wamp.connection.other')) as any;
		const registerError = new Error('register denied');
		const subscribeError = new Error('subscribe denied');
		client.register.mockImplementation(() => Promise.reject(registerError));
		client.subscribe.mockImplementation(() => Promise.reject(subscribeError));

		try {
			await startController();

			expect(logger.error).toHaveBeenCalledWith('Failed to register WAMP RPC', {
				connection: 'other',
				topic: 'test.rpc',
				error: registerError
			});
			expect(logger.error).toHaveBeenCalledWith('Failed to subscribe to WAMP topic', {
				connection: 'other',
				topic: 'test.topic',
				error: subscribeError
			});
			expect(errors.map((e) => [e.message, e.cause])).toEqual([
				['Failed to register WAMP RPC test.rpc on connection other', registerError],
				['Failed to subscribe to WAMP topic test.topic on connection other', subscribeError]
			]);
		} finally {
			Event.off('elysium:error');
		}
	});
});
