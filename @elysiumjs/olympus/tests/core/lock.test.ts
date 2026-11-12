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

import { MemoryLock } from '../../src/index';

describe('MemoryLock', () => {
	it('gives a key to one holder at a time', async () => {
		const lock = new MemoryLock();
		const first = await lock.acquire('k', 1000);
		expect(first).not.toBeNull();
		expect(await lock.acquire('k', 1000)).toBeNull();
		expect(await lock.acquire('other', 1000)).not.toBeNull();
		expect(await lock.release(first!)).toBe(true);
		expect(await lock.acquire('k', 1000)).not.toBeNull();
	});

	it('lets a lock expire after its time to live', async () => {
		const lock = new MemoryLock();
		const first = await lock.acquire('k', 20);
		await Bun.sleep(30);
		const second = await lock.acquire('k', 1000);
		expect(second).not.toBeNull();
		expect(await lock.release(first!)).toBe(false);
		expect(await lock.extend(first!, 1000)).toBe(false);
	});

	it('extends a held lock', async () => {
		const lock = new MemoryLock();
		const handle = (await lock.acquire('k', 30))!;
		await Bun.sleep(15);
		expect(await lock.extend(handle, 100)).toBe(true);
		await Bun.sleep(30);
		expect(await lock.acquire('k', 1000)).toBeNull();
	});

	it('waits for the holder, in the order of the waiters', async () => {
		const lock = new MemoryLock();
		const held = (await lock.acquire('k', 10_000))!;
		const order: string[] = [];
		const a = lock.acquire('k', 10_000, { wait: Infinity }).then(async (handle) => {
			order.push('a');
			await lock.release(handle!);
		});
		const b = lock.acquire('k', 10_000, { wait: Infinity }).then(async (handle) => {
			order.push('b');
			await lock.release(handle!);
		});
		await Bun.sleep(5);
		expect(order).toEqual([]);
		await lock.release(held);
		await Promise.all([a, b]);
		expect(order).toEqual(['a', 'b']);
	});

	it('gives up after a bounded wait, and takes an expired lock while waiting', async () => {
		const lock = new MemoryLock();
		await lock.acquire('k', 10_000);
		const started = Date.now();
		expect(await lock.acquire('k', 1000, { wait: 20 })).toBeNull();
		expect(Date.now() - started).toBeGreaterThanOrEqual(15);

		await lock.acquire('short', 20);
		expect(await lock.acquire('short', 1000, { wait: 1000 })).not.toBeNull();
	});

	it('runs work under the lock and lets go afterwards, also on a throw', async () => {
		const lock = new MemoryLock();
		expect(await lock.run('k', 1000, () => 42)).toEqual({ acquired: true, value: 42 });

		const held = (await lock.acquire('k', 1000))!;
		expect(await lock.run('k', 1000, () => 1)).toEqual({ acquired: false });
		await lock.release(held);

		await expect(
			lock.run('k', 1000, () => {
				throw new Error('boom');
			})
		).rejects.toThrow('boom');
		expect(await lock.acquire('k', 1000)).not.toBeNull();
	});
});
