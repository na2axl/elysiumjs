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

import { describe, expect, it, mock } from 'bun:test';

/** A Durable Object storage in memory, with its alarm. */
class FakeStorage {
	readonly data = new Map<string, unknown>();
	alarm: number | null = null;

	get = async <T>(key: string) => structuredClone(this.data.get(key)) as T | undefined;
	put = async (entries: Record<string, unknown>) => {
		for (const [key, value] of Object.entries(entries)) this.data.set(key, structuredClone(value));
	};
	delete = async (key: string) => this.data.delete(key);
	deleteAll = async () => this.data.clear();
	setAlarm = async (time: number) => {
		this.alarm = time;
	};
	deleteAlarm = async () => {
		this.alarm = null;
	};
}

mock.module('cloudflare:workers', () => ({
	DurableObject: class {
		constructor(
			protected ctx: unknown,
			protected env: unknown
		) {}
	}
}));

const { LockObject } = await import('../src/durable-objects');
const { DurableObjectLock } = await import('../src');
const { Lock } = await import('@elysiumjs/olympus');

/** A namespace binding that keeps one object per name, and counts the objects it made. */
const namespace = () => {
	const objects = new Map<
		string,
		{ object: InstanceType<typeof LockObject>; storage: FakeStorage }
	>();
	const entry = (name: string) => {
		if (!objects.has(name)) {
			const storage = new FakeStorage();
			objects.set(name, { object: new LockObject({ storage } as never, {}), storage });
		}
		return objects.get(name)!;
	};
	return {
		objects,
		entry,
		binding: {
			idFromName: (name: string) => name,
			get: (id: string) => entry(id).object
		}
	};
};

describe('DurableObjectLock', () => {
	it('registers as the durable-object lock driver', () => {
		expect(Lock.for('durable-object', { binding: namespace().binding })).toBeInstanceOf(
			DurableObjectLock
		);
	});

	it('gives a key to one holder at a time, in one object per key', async () => {
		const ns = namespace();
		const lock = new DurableObjectLock({ binding: () => ns.binding });
		const first = await lock.acquire('report:daily', 60_000);
		expect(first?.key).toBe('report:daily');
		expect(await lock.acquire('report:daily', 60_000)).toBeNull();
		expect(await lock.acquire('report:weekly', 60_000)).not.toBeNull();
		expect([...ns.objects.keys()]).toEqual(['report:daily', 'report:weekly']);
		expect(ns.entry('report:daily').storage.alarm).toBeGreaterThan(Date.now());
	});

	it('lets only the holder release or extend', async () => {
		const ns = namespace();
		const lock = new DurableObjectLock({ binding: ns.binding });
		const handle = (await lock.acquire('k', 60_000))!;
		expect(await lock.release({ key: 'k', token: 'other' })).toBe(false);
		expect(await lock.extend({ key: 'k', token: 'other' }, 60_000)).toBe(false);
		expect(await lock.extend(handle, 120_000)).toBe(true);
		expect(await lock.release(handle)).toBe(true);
		expect(ns.entry('k').storage.alarm).toBeNull();
		expect(await lock.release(handle)).toBe(false);
		expect(await lock.acquire('k', 60_000)).not.toBeNull();
	});

	it('frees a key once its time to live ends', async () => {
		const ns = namespace();
		const lock = new DurableObjectLock({ binding: ns.binding });
		const handle = (await lock.acquire('k', 5))!;
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(await lock.extend(handle, 60_000)).toBe(false);
		await ns.entry('k').object.alarm();
		expect(ns.entry('k').storage.data.size).toBe(0);
		expect(await lock.acquire('k', 60_000)).not.toBeNull();
	});

	it('refuses a time to live an alarm cannot hold', async () => {
		const ns = namespace();
		const lock = new DurableObjectLock({ binding: ns.binding });
		await expect(lock.acquire('k', Infinity)).rejects.toThrow('finite, positive time to live');
		await expect(lock.acquire('k', 0)).rejects.toThrow('finite, positive time to live');
		const handle = (await lock.acquire('k', 60_000))!;
		await expect(lock.extend(handle, Number.NaN)).rejects.toThrow('finite, positive time to live');
		expect(ns.objects.size).toBe(1);
	});

	it('waits for the holder within a bounded wait', async () => {
		const ns = namespace();
		const lock = new DurableObjectLock({ binding: ns.binding, retryDelay: 2 });
		const handle = (await lock.acquire('k', 60_000))!;
		setTimeout(() => void lock.release(handle), 10);
		expect(await lock.acquire('k', 60_000, { wait: 1_000 })).not.toBeNull();
		expect(await lock.acquire('k', 60_000, { wait: 10 })).toBeNull();
	});
});
