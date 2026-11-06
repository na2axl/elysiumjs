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

import type { RedisClientFactory, RedisConnection } from './connection';

import { ElysiumError } from '@elysiumjs/core';

/**
 * Raised when a Redis connection cannot run a command, such as pub/sub over HTTP.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class RedisFeatureNotSupportedError extends ElysiumError {
	constructor(adapter: string, feature: string) {
		super(`The ${adapter} Redis connection does not support ${feature}.`);
	}
}

/**
 * The parts of an ioredis client the adapter uses. An `ioredis` `Redis` instance fits it.
 * @author Axel Nana <axel.nana@workbud.com>
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
 * @author Axel Nana <axel.nana@workbud.com>
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

/**
 * Options of {@link upstash}.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type UpstashOptions = {
	/** The REST URL of the database. Defaults to the connection URL. */
	url?: string;
	/** The REST token of the database. */
	token: string;
	/** The `fetch` to send commands with. Defaults to the global one. */
	fetch?: typeof fetch;
};

/** Sends each command as a request to the Upstash REST API. */
class UpstashConnection implements RedisConnection {
	readonly #url: string;
	readonly #token: string;
	readonly #fetch: typeof fetch;

	public constructor(url: string, token: string, fetcher: typeof fetch) {
		this.#url = url.replace(/\/+$/, '');
		this.#token = token;
		this.#fetch = fetcher;
	}

	public readonly connected = true;
	public onconnect?: () => void;
	public onclose?: (error: unknown) => void;

	public async send(command: string, args: string[]): Promise<unknown> {
		const response = await this.#fetch(this.#url, {
			method: 'POST',
			headers: { authorization: `Bearer ${this.#token}`, 'content-type': 'application/json' },
			body: JSON.stringify([command, ...args])
		});
		const body = (await response.json().catch(() => ({}))) as { result?: unknown; error?: string };
		if (!response.ok || body.error !== undefined) {
			throw new ElysiumError(
				`Upstash answered ${response.status} to ${command}: ${body.error ?? 'no error message'}`
			);
		}
		return body.result ?? null;
	}

	public async get(key: string): Promise<string | null> {
		return (await this.send('GET', [key])) as string | null;
	}

	public set(key: string, value: string): Promise<unknown> {
		return this.send('SET', [key, value]);
	}

	public async del(...keys: string[]): Promise<number> {
		return Number(await this.send('DEL', keys));
	}

	public async expire(key: string, seconds: number): Promise<number> {
		return Number(await this.send('EXPIRE', [key, String(seconds)]));
	}

	public subscribe(): Promise<unknown> {
		return Promise.reject(new RedisFeatureNotSupportedError('Upstash REST', 'pub/sub'));
	}

	public unsubscribe(): Promise<unknown> {
		return Promise.reject(new RedisFeatureNotSupportedError('Upstash REST', 'pub/sub'));
	}

	public async duplicate(): Promise<RedisConnection> {
		return new UpstashConnection(this.#url, this.#token, this.#fetch);
	}

	public async connect(): Promise<void> {
		this.onconnect?.();
	}

	public close(): void {
		this.onclose?.(undefined);
	}
}

/**
 * Plugs Upstash Redis into the Redis port over its REST API, for Cloudflare Workers and other
 * runtimes without TCP sockets. Every command is one HTTP request; pub/sub is not supported.
 * @author Axel Nana <axel.nana@workbud.com>
 * @param options The REST token, and the REST URL when the connection URL is not it.
 * @example
 * ```ts
 * RedisModule.with({
 * 	client: upstash({ token: env.UPSTASH_REDIS_REST_TOKEN }),
 * 	connections: { default: { url: env.UPSTASH_REDIS_REST_URL } }
 * });
 * ```
 */
export const upstash =
	(options: UpstashOptions): RedisClientFactory =>
	(url) =>
		new UpstashConnection(options.url ?? url, options.token, options.fetch ?? fetch);
