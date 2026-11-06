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

import { describe, expect, it, mock } from 'bun:test';

import { runtime } from '../src';

describe('runtime', () => {
	it('is named bun', () => {
		expect(runtime.name).toBe('bun');
	});

	it('reads the process environment', () => {
		process.env.ELYSIUM_RUNTIME_TEST = 'yes';
		expect(runtime.env().ELYSIUM_RUNTIME_TEST).toBe('yes');
	});

	it('sleeps for the given duration', async () => {
		const start = performance.now();
		await runtime.sleep(5);
		expect(performance.now() - start).toBeGreaterThanOrEqual(4);
	});

	it('serves through the app listen method', () => {
		const app = { listen: mock() } as unknown as AnyElysia;
		runtime.serve(app, 1234);
		expect(app.listen).toHaveBeenCalledWith(1234);
	});

	it('exits through process.exit', () => {
		const original = process.exit;
		process.exit = mock() as unknown as typeof process.exit;
		try {
			runtime.exit(3);
			expect(process.exit).toHaveBeenCalledWith(3);
		} finally {
			process.exit = original;
		}
	});

	it('adds and removes shutdown handlers on SIGINT and SIGTERM', () => {
		const handler = () => {};
		const remove = runtime.onShutdown(handler);
		expect(process.listeners('SIGINT')).toContain(handler);
		expect(process.listeners('SIGTERM')).toContain(handler);
		remove();
		expect(process.listeners('SIGINT')).not.toContain(handler);
		expect(process.listeners('SIGTERM')).not.toContain(handler);
	});
});

describe('terminal and streams', () => {
	it('implements argv, write and terminal', () => {
		expect(runtime.argv()).toEqual(process.argv.slice(2));
		const original = process.stdout.write;
		const chunks: string[] = [];
		process.stdout.write = ((text: string) => (
			chunks.push(text),
			true
		)) as typeof process.stdout.write;
		try {
			runtime.write('stdout', 'hi');
		} finally {
			process.stdout.write = original;
		}
		expect(chunks).toEqual(['hi']);
		const terminal = runtime.terminal();
		expect(terminal?.input).toBe(process.stdin);
		expect(terminal?.output).toBe(process.stdout);
		expect(terminal?.clear).toBeFunction();
		expect(terminal?.moveCursor).toBeFunction();
		expect(terminal?.clearLine).toBeFunction();
	});
});
