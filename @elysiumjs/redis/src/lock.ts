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

import type { LockAcquireOptions, LockHandle } from '@elysiumjs/olympus';
import type { RedisConnection } from './connection';

import { Lock, LockDriver } from '@elysiumjs/olympus';

import { Redis } from './redis';

/**
 * Options of {@link RedisLock}.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type RedisLockOptions = {
	/** The `RedisModule` connection that holds the locks. Defaults to `default`. */
	connection?: string;

	/** The prefix of the lock keys. Defaults to `lock:`. */
	prefix?: string;

	/** How long to wait between two tries while waiting for a lock, in milliseconds. Defaults to 50. */
	retryDelay?: number;
};

declare module '@elysiumjs/olympus' {
	interface PortDrivers {
		'lock:redis': typeof RedisLock;
	}
}

/** Deletes the key when it still holds the token. */
const RELEASE = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end`;

/** Sets a new time to live on the key when it still holds the token. */
const EXTEND = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('PEXPIRE', KEYS[1], ARGV[2]) else return 0 end`;

/**
 * Holds locks in Redis, shared by every process that uses the same server: `SET NX PX` takes a
 * lock, and Lua scripts release and extend it only for its holder. Works with every client of
 * `RedisModule`, Upstash included.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @example
 * ```ts
 * HeraclesModule.with({ lock: Lock.for('redis', { connection: 'locks' }) });
 * ```
 */
@Lock.driver('redis')
export class RedisLock extends LockDriver {
	readonly #options: Required<RedisLockOptions>;

	constructor(options: RedisLockOptions = {}) {
		super();
		this.#options = {
			connection: options.connection ?? 'default',
			prefix: options.prefix ?? 'lock:',
			retryDelay: options.retryDelay ?? 50
		};
	}

	public async acquire(
		key: string,
		ttl: number,
		options: LockAcquireOptions = {}
	): Promise<LockHandle | null> {
		const deadline = Date.now() + Math.max(0, options.wait ?? 0);
		const token = crypto.randomUUID();
		const name = this.#key(key);
		for (;;) {
			const taken = await this.#redis().send('SET', [
				name,
				token,
				'NX',
				'PX',
				String(Math.max(1, Math.ceil(ttl)))
			]);
			if (taken === 'OK') return { key, token };
			const left = deadline - Date.now();
			if (left <= 0) return null;
			await new Promise((resolve) => setTimeout(resolve, Math.min(left, this.#options.retryDelay)));
		}
	}

	public async release(handle: LockHandle): Promise<boolean> {
		const deleted = await this.#redis().send('EVAL', [
			RELEASE,
			'1',
			this.#key(handle.key),
			handle.token
		]);
		return Number(deleted) === 1;
	}

	public async extend(handle: LockHandle, ttl: number): Promise<boolean> {
		const extended = await this.#redis().send('EVAL', [
			EXTEND,
			'1',
			this.#key(handle.key),
			handle.token,
			String(Math.max(1, Math.ceil(ttl)))
		]);
		return Number(extended) === 1;
	}

	#key(key: string): string {
		return `${this.#options.prefix}${key}`;
	}

	#redis(): RedisConnection {
		return Redis.getConnection(this.#options.connection);
	}
}
