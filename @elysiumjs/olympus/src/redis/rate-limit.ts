// Copyright (c) 2025-present Axel Nana <ax.lnana@outlook.com>. All rights reserved.
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
import type { RateLimitStore } from '../index';
import type { RedisConnection } from './connection';

import { Redis } from './redis';

/**
 * Keeps rate limit counts in Redis, shared by every process of the app. A count is an `INCR`ed
 * key that expires with its window.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @example
 * ```ts
 * @Application.register({ rateLimit: { store: new RedisRateLimitStore() } })
 * ```
 */
export class RedisRateLimitStore implements RateLimitStore {
	readonly #connection: string | RedisConnection;
	readonly #prefix: string;

	/**
	 * @param options The `RedisModule` connection (its name, `default` by default) or a connection,
	 * and a prefix for the keys.
	 */
	constructor(options: { connection?: string | RedisConnection; prefix?: string } = {}) {
		this.#connection = options.connection ?? 'default';
		this.#prefix = options.prefix ?? '';
	}

	public async hit(key: string, windowMs: number): Promise<{ count: number; resetAt: number }> {
		const redis =
			typeof this.#connection === 'string'
				? Redis.getConnection(this.#connection)
				: this.#connection;
		const name = `${this.#prefix}${key}`;
		const count = Number(await redis.send('INCR', [name]));
		if (count === 1) await redis.send('PEXPIRE', [name, String(windowMs)]);
		let ttl = Number(await redis.send('PTTL', [name]));
		if (ttl < 0) {
			// The process that opened the window failed before setting its expiry.
			await redis.send('PEXPIRE', [name, String(windowMs)]);
			ttl = windowMs;
		}
		return { count, resetAt: Date.now() + ttl };
	}
}
