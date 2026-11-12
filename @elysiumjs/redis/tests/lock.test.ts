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

import type { RedisConnection } from '../src/connection';

import { Lock } from '@elysiumjs/olympus';
import { afterEach, describe, expect, it, spyOn } from 'bun:test';

import { RedisLock } from '../src/lock';
import { Redis } from '../src/redis';

/** A Redis stand-in that understands the commands of the lock. */
const fakeRedis = () => {
	const keys = new Map<string, { value: string; expiresAt: number }>();
	const live = (key: string) => {
		const entry = keys.get(key);
		if (entry && entry.expiresAt <= Date.now()) keys.delete(key);
		return keys.get(key);
	};
	const sent: string[][] = [];
	const connection = {
		async send(command: string, args: string[]) {
			sent.push([command, ...args]);
			if (command === 'SET') {
				const [key, value, , , ttl] = args as [string, string, string, string, string];
				if (live(key)) return null;
				keys.set(key, { value, expiresAt: Date.now() + Number(ttl) });
				return 'OK';
			}
			if (command === 'EVAL') {
				const [script, , key, token, ttl] = args as [string, string, string, string, string?];
				const entry = live(key);
				if (!entry || entry.value !== token) return 0;
				if (script.includes("'DEL'")) keys.delete(key);
				else entry.expiresAt = Date.now() + Number(ttl);
				return 1;
			}
			return null;
		}
	} as unknown as RedisConnection;
	return { connection, keys, sent };
};

describe('RedisLock', () => {
	afterEach(() => {
		(Redis.getConnection as unknown as { mockRestore?: () => void }).mockRestore?.();
	});

	it('takes a lock with SET NX PX, on the configured connection and prefix', async () => {
		const { connection, sent } = fakeRedis();
		const getConnection = spyOn(Redis, 'getConnection').mockReturnValue(connection);
		const lock = new RedisLock({ connection: 'locks', prefix: 'app:lock:' });
		const handle = await lock.acquire('invoice:1', 1500);
		expect(handle?.key).toBe('invoice:1');
		expect(getConnection).toHaveBeenCalledWith('locks');
		expect(sent[0]).toEqual(['SET', 'app:lock:invoice:1', handle!.token, 'NX', 'PX', '1500']);
		expect(await lock.acquire('invoice:1', 1500)).toBeNull();
	});

	it('releases and extends only for its holder', async () => {
		const { connection } = fakeRedis();
		spyOn(Redis, 'getConnection').mockReturnValue(connection);
		const lock = new RedisLock();
		const handle = (await lock.acquire('k', 1000))!;
		expect(await lock.extend({ key: 'k', token: 'someone-else' }, 1000)).toBe(false);
		expect(await lock.release({ key: 'k', token: 'someone-else' })).toBe(false);
		expect(await lock.extend(handle, 5000)).toBe(true);
		expect(await lock.release(handle)).toBe(true);
		expect(await lock.acquire('k', 1000)).not.toBeNull();
	});

	it('waits for a lock by trying again', async () => {
		const { connection } = fakeRedis();
		spyOn(Redis, 'getConnection').mockReturnValue(connection);
		const lock = new RedisLock({ retryDelay: 5 });
		await lock.acquire('k', 30);
		expect(await lock.acquire('k', 1000, { wait: 10 })).toBeNull();
		expect(await lock.acquire('k', 1000, { wait: 200 })).not.toBeNull();
	});

	it('registers as the redis lock driver', () => {
		expect(Lock.for('redis', { connection: 'locks' })).toBeInstanceOf(RedisLock);
	});
});

describe.skipIf(!process.env.REDIS_URL)('RedisLock on a Redis server', () => {
	it('takes, extends and releases a lock', async () => {
		const client = new Bun.RedisClient(process.env.REDIS_URL!);
		const getConnection = spyOn(Redis, 'getConnection').mockReturnValue(
			client as unknown as RedisConnection
		);
		try {
			const lock = new RedisLock({ prefix: `test:lock:${crypto.randomUUID()}:` });
			const handle = (await lock.acquire('k', 1000))!;
			expect(handle).not.toBeNull();
			expect(await lock.acquire('k', 1000)).toBeNull();
			expect(await lock.extend(handle, 2000)).toBe(true);
			expect(await lock.release({ key: 'k', token: 'other' })).toBe(false);
			expect(await lock.release(handle)).toBe(true);
			expect(await lock.acquire('k', 50)).not.toBeNull();
			expect(await lock.acquire('k', 1000, { wait: 500 })).not.toBeNull();
		} finally {
			getConnection.mockRestore();
			client.close();
		}
	});
});
