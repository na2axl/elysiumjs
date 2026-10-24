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

import { describe, expect, it } from 'bun:test';

import { deepMerge } from '../src/utils.ts';

describe('deepMerge', () => {
	it('merges nested objects, the target winning', () => {
		const result = deepMerge({ a: { x: 1 }, p: 1 } as any, { a: { x: 2, y: 3 }, b: 1, p: 2 });
		expect(result).toEqual({ a: { x: 1, y: 3 }, b: 1, p: 1 });
	});

	it('does not mutate the target or the sources', () => {
		const target = { a: { x: 1 }, l: [1] } as any;
		const s1 = { a: { y: 2 }, l: [2], c: { d: 1 } } as any;
		const s2 = { a: { z: 3 } } as any;
		deepMerge(target, s1, s2);
		expect(target).toEqual({ a: { x: 1 }, l: [1] });
		expect(s1).toEqual({ a: { y: 2 }, l: [2], c: { d: 1 } });
		expect(s2).toEqual({ a: { z: 3 } });
	});

	it('does not alias nested objects of the sources or the target', () => {
		const target = { t: { v: 1 } } as any;
		const source = { c: { d: { e: 1 } }, l: [{ k: 1 }] } as any;
		const result = deepMerge(target, source);
		result.c.d.e = 99;
		result.l[0].k = 99;
		result.t.v = 99;
		expect(source).toEqual({ c: { d: { e: 1 } }, l: [{ k: 1 }] });
		expect(target).toEqual({ t: { v: 1 } });
	});

	it('merges arrays: primitives are unioned, objects merged by index', () => {
		expect(deepMerge({ l: [1, 2] } as any, { l: [2, 3] })).toEqual({ l: [1, 2, 3] });
		expect(deepMerge({ l: [{ a: 1 }] } as any, { l: [{ b: 2 }, { c: 3 }] })).toEqual({
			l: [{ a: 1, b: 2 }, { c: 3 }]
		});
		expect(deepMerge({} as any, { l: [1] })).toEqual({ l: [1] });
	});

	it('keeps class instances and functions by reference', () => {
		class Foo {}
		const foo = new Foo();
		const fn = () => 1;
		const result = deepMerge({} as any, { foo, fn });
		expect(result.foo).toBe(foo);
		expect(result.fn).toBe(fn);
	});
});
