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

import type { AnyElysia } from 'elysia';

import { afterEach, describe, expect, it, mock } from 'bun:test';

import { Application } from '../src/app';
import { Env } from '../src/env';
import { Event } from '../src/event';
import {
	bunRuntime,
	createWorkersRuntime,
	nodeRuntime,
	Runtime,
	RuntimeNotSupportedError
} from '../src/runtime';
import { Service } from '../src/service';
import { currentEnvironment } from '../src/utils';

/** A runtime whose every operation is recorded. */
const fakeRuntime = (env: Record<string, string | undefined> = {}) => {
	const shutdownHandlers: (() => void)[] = [];
	const removeShutdownHandler = mock(() => {});
	return {
		name: 'fake',
		env: () => env,
		sleep: mock(async (_ms: number) => {}),
		serve: mock((_app: AnyElysia, _port: number) => {}),
		exit: mock((_code: number) => {}),
		onShutdown: mock((handler: () => void) => {
			shutdownHandlers.push(handler);
			return removeShutdownHandler;
		}),
		createRedisClient: mock(() => ({ close: mock() })),
		shutdownHandlers,
		removeShutdownHandler
	} satisfies Runtime & Record<string, unknown>;
};

afterEach(() => {
	Runtime.reset();
	Env.clear();
	Service.clear();
	Event.off('elysium:server:after-init');
});

describe('Runtime', () => {
	it('detects Bun when the Bun global exists', () => {
		expect(Runtime.get()).toBe(bunRuntime);
	});

	it('detects Cloudflare Workers from the user agent', () => {
		expect(Runtime.detect({ navigator: { userAgent: 'Cloudflare-Workers' } }).name).toBe('workers');
	});

	it('falls back to Node.js', () => {
		expect(Runtime.detect({})).toBe(nodeRuntime);
	});

	it('keeps the detected runtime until reset', () => {
		const runtime = fakeRuntime();
		Runtime.use(runtime);
		expect(Runtime.get()).toBe(runtime);
		Runtime.reset();
		expect(Runtime.get()).toBe(bunRuntime);
	});
});

describe('bunRuntime', () => {
	it('reads process.env', () => {
		expect(bunRuntime.env()).toBe(process.env);
	});

	it('sleeps with a timer', async () => {
		const start = performance.now();
		await bunRuntime.sleep(5);
		expect(performance.now() - start).toBeGreaterThanOrEqual(4);
	});

	it('serves through the app listen method', () => {
		const app = { listen: mock() } as unknown as AnyElysia;
		bunRuntime.serve(app, 1234);
		expect(app.listen).toHaveBeenCalledWith(1234);
	});

	it('adds and removes shutdown handlers on SIGINT and SIGTERM', () => {
		const handler = () => {};
		const remove = bunRuntime.onShutdown(handler);
		expect(process.listeners('SIGINT')).toContain(handler);
		expect(process.listeners('SIGTERM')).toContain(handler);
		remove();
		expect(process.listeners('SIGINT')).not.toContain(handler);
		expect(process.listeners('SIGTERM')).not.toContain(handler);
	});

	it('creates Redis clients with Bun.RedisClient', () => {
		const original = Bun.RedisClient;
		const client = { close: mock() };
		const RedisClient = mock(function () {
			return client;
		});
		Bun.RedisClient = RedisClient as unknown as typeof Bun.RedisClient;
		try {
			expect(bunRuntime.createRedisClient('redis://localhost', { a: 1 })).toBe(client);
			expect(RedisClient).toHaveBeenCalledWith('redis://localhost', { a: 1 });
		} finally {
			Bun.RedisClient = original;
		}
	});

	it('exits through process.exit', () => {
		const original = process.exit;
		process.exit = mock() as unknown as typeof process.exit;
		try {
			bunRuntime.exit(3);
			expect(process.exit).toHaveBeenCalledWith(3);
		} finally {
			process.exit = original;
		}
	});
});

describe('nodeRuntime', () => {
	it('has no Redis client', () => {
		expect(() => nodeRuntime.createRedisClient('redis://localhost', {})).toThrow(
			RuntimeNotSupportedError
		);
	});
});

describe('createWorkersRuntime', () => {
	it('reads process.env by default, or the env it is given', () => {
		expect(createWorkersRuntime().env()).toBe(process.env);
		const env = { A: '1' };
		expect(createWorkersRuntime({ env }).env()).toBe(env);
	});

	it('refuses to serve, since the host owns the server', () => {
		expect(() => createWorkersRuntime().serve({} as AnyElysia, 3000)).toThrow(
			"Application.serve is not supported on the workers runtime. Export the app's fetch handler from the Worker instead."
		);
	});

	it('has no process to exit and no signals', () => {
		const runtime = createWorkersRuntime();
		expect(() => runtime.exit(1)).not.toThrow();
		expect(runtime.onShutdown(() => {})).toBeFunction();
	});

	it('has no Redis client', () => {
		expect(() => createWorkersRuntime().createRedisClient('redis://localhost', {})).toThrow(
			'RedisModule is not supported on the workers runtime.'
		);
	});

	it('sleeps with a timer', async () => {
		await expect(createWorkersRuntime().sleep(1)).resolves.toBeUndefined();
	});
});

describe('Application on a custom runtime', () => {
	it('reads its environment from the runtime', () => {
		Runtime.use(fakeRuntime({ NODE_ENV: 'staging', FOO: 'bar' }));

		@Application.register({ modules: [] })
		class TestApp extends Application {}
		new TestApp();

		expect(Env.get('FOO')).toBe('bar');
		expect(currentEnvironment()).toBe('staging');
	});

	it('serves, exits and handles signals through the runtime', async () => {
		const runtime = fakeRuntime({ PORT: '4321' });
		Runtime.use(runtime);

		@Application.register({ modules: [], openapi: false })
		class TestApp extends Application {}
		const app = new TestApp();

		await app.run(['serve']);
		expect(runtime.onShutdown).toHaveBeenCalledTimes(1);
		expect(runtime.serve).toHaveBeenCalledWith(app.elysia, 4321);

		await app.run(['list']);
		expect(runtime.removeShutdownHandler).toHaveBeenCalled();
		expect(runtime.exit).toHaveBeenCalledWith(0);
	});
});
