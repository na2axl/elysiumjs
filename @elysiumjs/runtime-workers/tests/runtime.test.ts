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

import { RuntimeNotSupportedError } from '@elysiumjs/core';
import { describe, expect, it } from 'bun:test';

import { createRuntime, runtime } from '../src';

describe('createRuntime', () => {
	it('is named workers', () => {
		expect(runtime.name).toBe('workers');
	});

	it('reads process.env by default, or the env it is given', () => {
		expect(createRuntime().env()).toBe(process.env);
		const env = { A: '1' };
		expect(createRuntime({ env }).env()).toBe(env);
	});

	it('refuses to serve, since the host owns the server', () => {
		expect(() => runtime.serve({} as AnyElysia, 3000)).toThrow(RuntimeNotSupportedError);
		expect(() => runtime.serve({} as AnyElysia, 3000)).toThrow(
			"Application.serve is not supported on the workers runtime. Export the app's fetch handler from the Worker instead."
		);
	});

	it('has no process to exit and no signals', () => {
		const exit = process.exit;
		expect(() => runtime.exit(1)).not.toThrow();
		expect(process.exit).toBe(exit);
		const before = process.listeners('SIGINT').length;
		const remove = runtime.onShutdown(() => {});
		expect(process.listeners('SIGINT')).toHaveLength(before);
		expect(remove).toBeFunction();
		remove();
	});

	it('sleeps with a timer', async () => {
		await expect(runtime.sleep(1)).resolves.toBeUndefined();
	});
});
