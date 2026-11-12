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

import { ElysiumError } from '@elysiumjs/core';

import { RedisFeatureNotSupportedError } from '../errors';

/**
 * Options of {@link upstash}.
 * @author Axel Nana <ax.lnana@outlook.com>
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
 * @author Axel Nana <ax.lnana@outlook.com>
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
	(url) => {
		const restUrl = options.url ?? url;
		if (!restUrl || !options.token) {
			throw new ElysiumError(
				'The Upstash Redis connection needs a REST URL and a REST token. Set the connection URL (or the url option) and the token option.'
			);
		}
		return new UpstashConnection(restUrl, options.token, options.fetch ?? fetch);
	};
