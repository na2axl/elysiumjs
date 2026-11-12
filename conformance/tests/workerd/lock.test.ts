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

import type { LockObjectNamespace } from '@elysiumjs/workers';

import { Lock } from '@elysiumjs/olympus';
import { DurableObjectLock } from '@elysiumjs/workers';
import { env, runDurableObjectAlarm } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

const locks = (
	env as unknown as { LOCKS: LockObjectNamespace & { idFromName(name: string): never } }
).LOCKS;

describe('DurableObjectLock (workerd)', () => {
	it('is the durable-object driver of the Lock port', () => {
		expect(Lock.for('durable-object', { binding: locks })).toBeInstanceOf(DurableObjectLock);
	});

	it('gives a key to one holder over RPC, until it lets go', async () => {
		const lock = Lock.for('durable-object', { binding: locks });
		const key = `report:${crypto.randomUUID()}`;
		const handle = await lock.acquire(key, 60_000);
		expect(handle).not.toBeNull();
		expect(await lock.acquire(key, 60_000)).toBeNull();
		expect(await lock.extend(handle!, 60_000)).toBe(true);
		expect(await lock.release({ key, token: 'someone-else' })).toBe(false);
		expect(await lock.release(handle!)).toBe(true);
		expect(await lock.acquire(key, 60_000)).not.toBeNull();
	});

	it('frees a key whose time to live ended', async () => {
		const lock = Lock.for('durable-object', { binding: locks });
		const key = `report:${crypto.randomUUID()}`;
		const handle = await lock.acquire(key, 20);
		await new Promise((resolve) => setTimeout(resolve, 40));
		// workerd may have run the alarm already; running it again is harmless.
		await runDurableObjectAlarm(locks.get(locks.idFromName(key)) as never);
		expect(await lock.extend(handle!, 60_000)).toBe(false);
		expect(await lock.acquire(key, 60_000)).not.toBeNull();
	});
});
