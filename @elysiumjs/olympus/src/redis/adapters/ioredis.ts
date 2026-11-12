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

/**
 * The parts of an ioredis client the adapter uses. An `ioredis` `Redis` instance fits it.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export interface IoredisLike {
	readonly status: string;
	call(command: string, ...args: string[]): Promise<unknown>;
	get(key: string): Promise<string | null>;
	set(key: string, value: string): Promise<unknown>;
	del(...keys: string[]): Promise<number>;
	expire(key: string, seconds: number): Promise<number>;
	subscribe(...channels: string[]): Promise<unknown>;
	unsubscribe(...channels: string[]): Promise<unknown>;
	on(event: string, listener: (...args: any[]) => void): unknown;
	off(event: string, listener: (...args: any[]) => void): unknown;
	duplicate(): IoredisLike;
	connect(): Promise<void>;
	quit(): Promise<unknown>;
}

/** Adapts an ioredis client to {@link RedisConnection}. */
class IoredisConnection implements RedisConnection {
	readonly #client: IoredisLike;
	readonly #listeners = new Map<string, (message: string, channel: string) => void>();
	#onconnect?: () => void;
	#onclose?: (error: unknown) => void;

	public constructor(client: IoredisLike) {
		this.#client = client;
		client.on('ready', () => this.#onconnect?.());
		client.on('end', () => this.#onclose?.(undefined));
		client.on('message', (channel: string, message: string) =>
			this.#listeners.get(channel)?.(message, channel)
		);
	}

	public get connected(): boolean {
		return this.#client.status === 'ready';
	}

	public set onconnect(handler: (() => void) | undefined) {
		this.#onconnect = handler;
	}

	public set onclose(handler: ((error: unknown) => void) | undefined) {
		this.#onclose = handler;
	}

	public send(command: string, args: string[]): Promise<unknown> {
		return this.#client.call(command, ...args);
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

	public async subscribe(
		channel: string,
		listener: (message: string, channel: string) => void
	): Promise<unknown> {
		this.#listeners.set(channel, listener);
		return this.#client.subscribe(channel);
	}

	public async unsubscribe(channel?: string): Promise<unknown> {
		if (channel === undefined) {
			this.#listeners.clear();
			return this.#client.unsubscribe();
		}
		this.#listeners.delete(channel);
		return this.#client.unsubscribe(channel);
	}

	public async duplicate(): Promise<RedisConnection> {
		return new IoredisConnection(this.#client.duplicate());
	}

	public async connect(): Promise<void> {
		if (this.#client.status === 'ready' || this.#client.status === 'connecting') return;
		await this.#client.connect();
	}

	public async close(): Promise<void> {
		await this.#client.quit();
	}
}

/**
 * Plugs an ioredis client into the Redis port, for Node.js. Pass a function that creates the
 * client; the module passes each connection's URL and options to it. Create it with
 * `lazyConnect: true` so that it connects on `connect()`.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @param create Creates an ioredis client.
 * @example
 * ```ts
 * import IORedis from 'ioredis';
 *
 * RedisModule.with({
 * 	client: ioredis((url, options) => new IORedis(url, { ...options, lazyConnect: true })),
 * 	connections: { default: { url: process.env.REDIS_URL! } }
 * });
 * ```
 */
export const ioredis =
	(create: (url: string, options: Record<string, unknown>) => IoredisLike): RedisClientFactory =>
	(url, options) =>
		new IoredisConnection(create(url, options));
