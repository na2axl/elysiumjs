// Copyright (c) 2026-present Axel Nana <ax.lnana@outlook.com>. All rights reserved.
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

import { Json } from '../../src/json';

describe('Json', () => {
	it('keeps dates at any depth', () => {
		const value = { at: new Date('2026-01-01T00:00:00Z'), list: [{ due: new Date(0) }], n: 1 };
		const text = Json.stringify(value);
		expect(JSON.parse(text)).toEqual({
			at: { $date: '2026-01-01T00:00:00.000Z' },
			list: [{ due: { $date: '1970-01-01T00:00:00.000Z' } }],
			n: 1
		});
		expect(Json.parse(text)).toEqual(value);
	});

	it('escapes plain objects that look like tags', () => {
		const value = { a: { $date: 'not a date' }, b: { $escaped: { x: 1 } } };
		expect(Json.parse(Json.stringify(value))).toEqual(value);
	});

	it('tells whether a value comes back as it was', () => {
		expect(Json.survives({ at: new Date(), tags: ['a'], n: null })).toBe(true);
		expect(Json.survives({ map: new Map() })).toBe(false);
		expect(Json.survives({ fn: () => 1 })).toBe(false);
		expect(Json.survives([undefined])).toBe(false);
		expect(Json.survives(undefined)).toBe(false);
		expect(Json.survives({ n: Number.NaN })).toBe(false);
		const cycle: Record<string, unknown> = {};
		cycle.self = cycle;
		expect(Json.survives(cycle)).toBe(false);
		const shared = { x: 1 };
		expect(Json.survives([shared, shared])).toBe(true);
	});
});
