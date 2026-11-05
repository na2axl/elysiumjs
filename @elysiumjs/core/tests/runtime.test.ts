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
import type { Runtime as RuntimePort } from '../src/runtime';

import { afterEach, describe, expect, it, mock } from 'bun:test';

import { Application } from '../src/app';
import { Env } from '../src/env';
import { Runtime, RuntimeNotConfiguredError, RuntimeNotSupportedError } from '../src/runtime';
import { Service } from '../src/service';
import { currentEnvironment } from '../src/utils';
import { testRuntime } from './test-runtime';

/** A runtime whose every operation is recorded. */
const fakeRuntime = (env: Record<string, string | undefined> = {}) => {
	const removeShutdownHandler = mock(() => {});
	return {
		name: 'fake',
		env: () => env,
		sleep: mock(async (_ms: number) => {}),
		serve: mock((_app: AnyElysia, _port: number) => {}),
		exit: mock((_code: number) => {}),
		onShutdown: mock((_handler: () => void) => removeShutdownHandler),
		removeShutdownHandler
	} satisfies RuntimePort & Record<string, unknown>;
};

afterEach(() => {
	Runtime.use(testRuntime);
	Env.clear();
	Service.clear();
});

describe('Runtime', () => {
	it('throws a helpful error when no runtime is set', () => {
		Runtime.reset();
		expect(Runtime.find()).toBeUndefined();
		expect(() => Runtime.get()).toThrow(RuntimeNotConfiguredError);
		expect(() => Runtime.get()).toThrow('@elysiumjs/runtime-bun');
	});

	it('returns the runtime set with use', () => {
		const runtime = fakeRuntime();
		Runtime.use(runtime);
		expect(Runtime.get()).toBe(runtime);
		expect(Runtime.find()).toBe(runtime);
	});

	it('names the feature and runtime when a feature is not supported', () => {
		expect(new RuntimeNotSupportedError('X', 'workers', 'Do Y.').message).toBe(
			'X is not supported on the workers runtime. Do Y.'
		);
		expect(new RuntimeNotSupportedError('X', 'node').message).toBe(
			'X is not supported on the node runtime.'
		);
	});
});

describe('currentEnvironment', () => {
	it('reads NODE_ENV from the runtime', () => {
		Runtime.use(fakeRuntime({ NODE_ENV: 'staging' }));
		expect(currentEnvironment()).toBe('staging');
	});

	it('defaults to development when unset or when no runtime is set', () => {
		Runtime.use(fakeRuntime({}));
		expect(currentEnvironment()).toBe('development');
		Runtime.reset();
		expect(currentEnvironment()).toBe('development');
	});
});

describe('Application runtime option', () => {
	it('sets the runtime when the application is created, keeping the same object', () => {
		Runtime.reset();
		const runtime = fakeRuntime({ FOO: 'bar' });

		@Application.register({ runtime, modules: [] })
		class TestApp extends Application {}
		new TestApp();

		expect(Runtime.get()).toBe(runtime);
		expect(Env.get('FOO')).toBe('bar');
	});

	it('inherits the runtime of a parent application', () => {
		Runtime.reset();
		const runtime = fakeRuntime();

		@Application.register({ runtime })
		class BaseApp extends Application {}

		@Application.register({ modules: [] })
		class TestApp extends BaseApp {}
		new TestApp();

		expect(Runtime.get()).toBe(runtime);
	});

	it('fails without a runtime option or Runtime.use', () => {
		Runtime.reset();

		@Application.register({ modules: [] })
		class TestApp extends Application {}

		expect(() => new TestApp()).toThrow(RuntimeNotConfiguredError);
	});

	it('serves, exits and handles signals through the runtime', async () => {
		const runtime = fakeRuntime({ PORT: '4321' });

		@Application.register({ runtime, modules: [], openapi: false })
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
