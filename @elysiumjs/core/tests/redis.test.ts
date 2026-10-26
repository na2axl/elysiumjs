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

import { Container } from '../src/container';
import { InvalidModuleConfigError, ServiceNotFoundError } from '../src/errors';
import { ConsoleLogger, LOGGER_SERVICE } from '../src/logger';
import { Redis, RedisModule } from '../src/redis';
import { Service } from '../src/service';
import { createTestingApp } from '../src/testing';

const createClient = () => ({ close: mock() });
const clients: ReturnType<typeof createClient>[] = [];

const originalRedisClient = Bun.RedisClient;
const ClientMock = mock(function (_url: string, _options?: object) {
	const client = createClient();
	clients.push(client);
	return client;
});
Bun.RedisClient = ClientMock as unknown as typeof Bun.RedisClient;

afterAll(() => {
	Bun.RedisClient = originalRedisClient;
});

const config = {
	default: 'main',
	connections: {
		main: { url: 'redis://main:6379', db: 1 },
		cache: { url: 'redis://cache:6379' }
	}
};

describe('RedisModule', () => {
	let app: TestingApp | undefined;

	beforeEach(() => {
		clients.length = 0;
		ClientMock.mockClear();
	});

	afterEach(async () => {
		await app?.shutdown();
		app = undefined;
	});

	it('creates no client until the first get', async () => {
		app = await createTestingApp({ modules: [RedisModule.with(config)] });
		expect(ClientMock).not.toHaveBeenCalled();
		expect(Redis.connectionExists('cache')).toBe(true);
	});

	it('resolves a named connection through Redis.getConnection', async () => {
		app = await createTestingApp({ modules: [RedisModule.with(config)] });
		await app.get('redis.connection.cache');
		const client = Redis.getConnection('cache');
		expect(client).toBe(clients[0] as any);
		expect(ClientMock).toHaveBeenCalledWith('redis://cache:6379', {});
		expect(Redis.getConnection('cache')).toBe(client);
	});

	it('passes the other options to the client', async () => {
		app = await createTestingApp({ modules: [RedisModule.with(config)] });
		await app.get('redis.connection.main');
		expect(ClientMock).toHaveBeenCalledWith('redis://main:6379', { db: 1 });
	});

	it('resolves the default alias to the configured connection, sharing its instance', async () => {
		app = await createTestingApp({ modules: [RedisModule.with(config)] });
		await app.get('redis.connection.default');
		expect(Redis.getDefaultConnection()).toBe(Redis.getConnection('main'));
		expect(Redis.getConnection()).toBe(Redis.getConnection('main'));
		expect(ClientMock).toHaveBeenCalledTimes(1);
	});

	it('throws ServiceNotFoundError for an unknown connection', async () => {
		app = await createTestingApp({ modules: [RedisModule.with(config)] });
		expect(() => Redis.getConnection('nope')).toThrow(ServiceNotFoundError);
		expect(Redis.connectionExists('nope')).toBe(false);
	});

	it('closes only the clients that were created on shutdown', async () => {
		app = await createTestingApp({ modules: [RedisModule.with(config)] });
		await app.get('redis.connection.cache');
		await app.shutdown();
		app = undefined;
		expect(clients).toHaveLength(1);
		expect(clients[0].close).toHaveBeenCalledTimes(1);
		expect(Container.constructed()).toHaveLength(0);
	});

	it('closes a client shared with the default alias once', async () => {
		app = await createTestingApp({ modules: [RedisModule.with(config)] });
		await app.get('redis.connection.default');
		await app.shutdown();
		app = undefined;
		expect(clients[0].close).toHaveBeenCalledTimes(1);
	});

	it('closes every client with eager boot', async () => {
		app = await createTestingApp({ modules: [RedisModule.with(config)], boot: 'eager' });
		await app.shutdown();
		app = undefined;
		expect(clients).toHaveLength(2);
		for (const client of clients) expect(client.close).toHaveBeenCalledTimes(1);
	});

	it('requires connections', async () => {
		await expect(createTestingApp({ modules: [RedisModule.with({})] })).rejects.toThrow(
			/connections/
		);
	});

	it('serves the sync getter before any awaited get, as the module initialises synchronously', async () => {
		app = await createTestingApp({ modules: [RedisModule.with(config)] });
		expect(Redis.getConnection('cache')).toBe(Redis.getConnection('cache'));
	});

	it('defaults the default connection to "default"', async () => {
		app = await createTestingApp({
			modules: [RedisModule.with({ connections: { default: { url: 'redis://d:6379' } } })]
		});
		await app.get('redis.connection.default');
		expect(Redis.getConnection()).toBe(clients[0] as any);
		expect(ClientMock).toHaveBeenCalledTimes(1);
	});

	it('works with a connection named default and an explicit default', async () => {
		app = await createTestingApp({
			modules: [
				RedisModule.with({
					default: 'default',
					connections: { default: { url: 'redis://d:6379' } }
				})
			]
		});
		await app.get('redis.connection.default');
		expect(Redis.getDefaultConnection()).toBe(clients[0] as any);
	});

	it('rejects an unknown default connection', async () => {
		await expect(
			createTestingApp({
				modules: [RedisModule.with({ default: 'nope', connections: config.connections })]
			})
		).rejects.toThrow(InvalidModuleConfigError);
	});

	it('rejects a default alias colliding with a connection named default', async () => {
		await expect(
			createTestingApp({
				modules: [
					RedisModule.with({
						default: 'main',
						connections: { ...config.connections, default: { url: 'redis://d:6379' } }
					})
				]
			})
		).rejects.toThrow(InvalidModuleConfigError);
	});

	it('closes every client even if one throws, then rethrows the error', async () => {
		app = await createTestingApp({ modules: [RedisModule.with(config)], boot: 'eager' });
		clients[0].close.mockImplementation(() => {
			throw new Error('boom');
		});
		const logger = new ConsoleLogger();
		const errorSpy = spyOn(logger, 'error').mockImplementation(() => {});
		Service.instance(LOGGER_SERVICE, logger);
		try {
			await app.shutdown();
			app = undefined;
			// The kernel logs module destroy failures instead of throwing.
			expect(errorSpy).toHaveBeenCalledWith('Error while destroying', {
				target: expect.stringContaining('RedisModule'),
				error: expect.objectContaining({ message: 'boom' })
			});
		} finally {
			if (Service.exists(LOGGER_SERVICE)) Service.remove(LOGGER_SERVICE);
		}
		expect(clients[1].close).toHaveBeenCalledTimes(1);
	});
});
