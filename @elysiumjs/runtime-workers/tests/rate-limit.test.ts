// Copyright (c) 2026-present Workbud Technologies Inc. All rights reserved.
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

import { describe, expect, it, setSystemTime } from 'bun:test';

import { DurableObjectRateLimitStore, RateLimiterObject, runInvocation } from '../src';

const memoryState = () => {
	const data = new Map<string, unknown>();
	const alarms: number[] = [];
	return {
		data,
		alarms,
		storage: {
			get: async <T>(key: string) => data.get(key) as T | undefined,
			put: async <T>(key: string, value: T) => void data.set(key, value),
			deleteAll: async () => data.clear(),
			setAlarm: async (time: number) => void alarms.push(time)
		}
	};
};

/** A namespace holding one object per name, as Durable Objects do. */
const namespace = () => {
	const objects = new Map<string, RateLimiterObject>();
	return {
		objects,
		idFromName: (name: string) => name,
		get: (id: string) => {
			if (!objects.has(id)) objects.set(id, new RateLimiterObject(memoryState()));
			const object = objects.get(id)!;
			return {
				fetch: (input: string, init?: RequestInit) => object.fetch(new Request(input, init))
			};
		}
	};
};

const ctx = () => ({ waitUntil() {}, passThroughOnException() {} });

describe('RateLimiterObject', () => {
	it('counts hits in a window, then opens a new one', async () => {
		const state = memoryState();
		const object = new RateLimiterObject(state);
		setSystemTime(new Date(1_000_000));
		expect(await object.hit(1000)).toEqual({ count: 1, resetAt: 1_001_000 });
		expect(await object.hit(1000)).toEqual({ count: 2, resetAt: 1_001_000 });
		expect(state.alarms).toEqual([1_001_000]);
		setSystemTime(new Date(1_001_000));
		expect(await object.hit(1000)).toEqual({ count: 1, resetAt: 1_002_000 });
		setSystemTime();
	});

	it('clears its storage once the window has ended', async () => {
		const state = memoryState();
		const object = new RateLimiterObject(state);
		setSystemTime(new Date(1_000_000));
		await object.hit(1000);
		await object.alarm();
		expect(state.data.size).toBe(1);
		setSystemTime(new Date(1_001_000));
		await object.alarm();
		expect(state.data.size).toBe(0);
		setSystemTime();
	});
});

describe('DurableObjectRateLimitStore', () => {
	it('counts each key in its own object, through the binding of the invocation', async () => {
		const RATE_LIMITER = namespace();
		const store = new DurableObjectRateLimitStore({ binding: 'RATE_LIMITER' });
		const counts = await runInvocation({ env: { RATE_LIMITER }, ctx: ctx() }, async () => [
			(await store.hit('a', 60_000)).count,
			(await store.hit('a', 60_000)).count,
			(await store.hit('b', 60_000)).count
		]);
		expect(counts).toEqual([1, 2, 1]);
		expect([...RATE_LIMITER.objects.keys()]).toEqual(['a', 'b']);
	});
});
