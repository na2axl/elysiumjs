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

import type { RedisClientFactory, RedisConnection } from '../connection';

import { ElysiumError } from '../../index';

// portability-allow: the Bun adapter, the only place that references Bun's Redis client
type BunClient = Bun.RedisClient;

/** Adapts a `Bun.RedisClient` to {@link RedisConnection}. */
class BunRedisConnection implements RedisConnection {
	readonly #client: BunClient;

	public constructor(client: BunClient) {
		this.#client = client;
	}

	public get connected(): boolean {
		return this.#client.connected;
	}

	public set onconnect(handler: (() => void) | undefined) {
		this.#client.onconnect = handler ?? null!;
	}

	public set onclose(handler: ((error: unknown) => void) | undefined) {
		this.#client.onclose = (handler ?? null!) as (error: Error) => void;
	}

	public send(command: string, args: string[]): Promise<unknown> {
		return this.#client.send(command, args);
	}

	public get(key: string): Promise<string | null> {
		return this.#client.get(key);
	}

	public set(key: string, value: string): Promise<unknown> {
		return this.#client.set(key, value);
	}

	public del(...keys: string[]): Promise<number> {
		return this.#client.del(...keys);
	}

	public expire(key: string, seconds: number): Promise<number> {
		return this.#client.expire(key, seconds);
	}

	public subscribe(
		channel: string,
		listener: (message: string, channel: string) => void
	): Promise<unknown> {
		return this.#client.subscribe(channel, listener);
	}

	public unsubscribe(channel?: string): Promise<unknown> {
		return channel === undefined ? this.#client.unsubscribe() : this.#client.unsubscribe(channel);
	}

	public async duplicate(): Promise<RedisConnection> {
		return new BunRedisConnection(await this.#client.duplicate());
	}

	public connect(): Promise<void> {
		return this.#client.connect();
	}

	public close(): void {
		this.#client.close();
	}
}

/**
 * Creates a connection with Bun's built-in Redis client, the default client of `RedisModule`.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export const bunRedis: RedisClientFactory = (url, options) => {
	if (typeof Bun === 'undefined') {
		throw new ElysiumError(
			'The default Redis client only runs on Bun: pass `client: ioredis(...)` on Node.js, or ' +
				'`client: upstash(...)` on Cloudflare Workers.'
		);
	}
	// portability-allow: only reached on Bun, checked above
	return new BunRedisConnection(new Bun.RedisClient(url, options as Bun.RedisOptions));
};
