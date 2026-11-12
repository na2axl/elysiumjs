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

import type { SessionData, SessionStore } from '@elysiumjs/olympus/themis';
import type { RedisConnection } from '../connection';

/**
 * Keeps sessions in Redis, under `session:<id>`, expiring with the session.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class RedisSessionStore implements SessionStore {
	constructor(
		private readonly options: {
			/** The Redis connection, or a function that returns it (such as `() => Redis.connection()`). */
			connection: RedisConnection | (() => RedisConnection);
			/** The prefix of the keys. Defaults to `session:`. */
			prefix?: string;
		}
	) {}

	private get redis(): RedisConnection {
		const { connection } = this.options;
		return typeof connection === 'function' ? connection() : connection;
	}

	private key(id: string): string {
		return `${this.options.prefix ?? 'session:'}${id}`;
	}

	public async load(id: string): Promise<SessionData | null> {
		const raw = await this.redis.get(this.key(id));
		return raw === null ? null : (JSON.parse(raw) as SessionData);
	}

	public async save(id: string, data: SessionData, ttlSeconds: number): Promise<void> {
		await this.redis.send('SET', [this.key(id), JSON.stringify(data), 'EX', String(ttlSeconds)]);
	}

	public async destroy(id: string): Promise<void> {
		await this.redis.del(this.key(id));
	}
}
