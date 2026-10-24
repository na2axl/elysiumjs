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

import type { ModuleNode } from '../src/module-graph';

import { afterEach, describe, expect, it } from 'bun:test';

import { ModuleContext } from '../src/module-context';
import { currentEnvironment, Symbols } from '../src/utils';

const node = (id: string): ModuleNode => ({ id });

describe('ModuleContext', () => {
	it('current() is undefined outside run', () => {
		expect(ModuleContext.current()).toBeUndefined();
	});

	it('run() returns the value of fn and exposes the node', () => {
		const a = node('A');
		const result = ModuleContext.run(a, () => {
			expect(ModuleContext.current()).toBe(a);
			return 42;
		});
		expect(result).toBe(42);
		expect(ModuleContext.current()).toBeUndefined();
	});

	it('survives await inside run', async () => {
		const a = node('A');
		await ModuleContext.run(a, async () => {
			await Promise.resolve();
			await new Promise((r) => setTimeout(r, 1));
			expect(ModuleContext.current()).toBe(a);
		});
	});

	it('nested run restores the outer node', () => {
		const a = node('A');
		const b = node('B');
		ModuleContext.run(a, () => {
			ModuleContext.run(b, () => {
				expect(ModuleContext.current()).toBe(b);
			});
			expect(ModuleContext.current()).toBe(a);
		});
	});
});

describe('currentEnvironment', () => {
	const original = process.env.NODE_ENV;

	afterEach(() => {
		if (original === undefined) delete process.env.NODE_ENV;
		else process.env.NODE_ENV = original;
	});

	it("defaults to 'development'", () => {
		delete process.env.NODE_ENV;
		expect(currentEnvironment()).toBe('development');
	});

	it('reads NODE_ENV', () => {
		process.env.NODE_ENV = 'test';
		expect(currentEnvironment()).toBe('test');
	});
});

describe('Symbols', () => {
	it('exposes module system symbols', () => {
		for (const key of ['serviceOptions', 'module', 'configuredModule', 'moduleConfig'] as const) {
			expect(typeof Symbols[key]).toBe('symbol');
		}
	});
});
