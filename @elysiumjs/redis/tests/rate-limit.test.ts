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
import type { RedisConnection } from '../src/connection';
import type { RedisClientFactory, RedisConnection } from './connection';

import { describe, expect, it } from 'bun:test';

import { RedisRateLimitStore } from '../src/rate-limit';

/** A Redis stand-in that implements the commands of the store. */
const fakeRedis = () => {
	const counts = new Map<string, number>();
	const ttls = new Map<string, number>();
	const commands: string[] = [];
	const connection = {
		async send(command: string, args: string[]) {
			commands.push(`${command} ${args.join(' ')}`);
			const [key, value] = args as [string, string];
			if (command === 'INCR') {
				counts.set(key, (counts.get(key) ?? 0) + 1);
				return counts.get(key);
			}
			if (command === 'PEXPIRE') {
				ttls.set(key, Number(value));
				return 1;
			}
			if (command === 'PTTL') return ttls.get(key) ?? -1;
			throw new Error(`unexpected ${command}`);
		}
	} as unknown as RedisConnection;
	return { connection, commands, ttls };
};

describe('RedisRateLimitStore', () => {
	it('increments the key and sets its expiry on the first hit of a window', async () => {
		const { connection, commands } = fakeRedis();
		const store = new RedisRateLimitStore({ connection, prefix: 'app:' });

		const first = await store.hit('k', 1000);
		const second = await store.hit('k', 1000);

		expect(first.count).toBe(1);
		expect(second.count).toBe(2);
		expect(second.resetAt).toBeGreaterThan(Date.now());
		expect(commands).toEqual([
			'INCR app:k',
			'PEXPIRE app:k 1000',
			'PTTL app:k',
			'INCR app:k',
			'PTTL app:k'
		]);
	});

	it('sets a missing expiry again', async () => {
		const { connection, commands, ttls } = fakeRedis();
		const store = new RedisRateLimitStore({ connection });
		await store.hit('k', 1000);
		ttls.delete('k');

		await store.hit('k', 1000);

		expect(commands.slice(-2)).toEqual(['PTTL k', 'PEXPIRE k 1000']);
	});
});
