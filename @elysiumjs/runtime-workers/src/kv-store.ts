// Copyright (c) 2026-present Workbud Technologies Inc. All rights reserved.
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

import type { WorkersKVNamespace } from './types';

import { getLogger } from '@elysiumjs/core';

import { Workers } from './workers';

/**
 * Options of {@link KeyvWorkersKV}.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type KeyvWorkersKVOptions = {
	/** The name of the KV namespace binding. */
	binding: string;
	/** The namespace prefixed to every key. Keyv sets it. */
	namespace?: string;
	/** The separator between the namespace and the key. Defaults to `::`. */
	keyPrefixSeparator?: string;
	/**
	 * The most KV operations (one per listed page, one per deleted key) one `clear()` makes, so
	 * that it stays within the subrequest limit of an invocation. Defaults to 900, under the 1000
	 * of the paid plan; set 45 on the free plan. Keys left over are logged, and the next
	 * `clear()` goes on with them.
	 */
	maxOperations?: number;
};

/** Workers KV refuses expirations shorter than 60 seconds. */
const MIN_TTL_SECONDS = 60;

/** Keys deleted at once by `clear()`, to stay within the concurrency limits. */
const KV_DELETE_CHUNK = 50;

/** The default operation budget of `clear()`. */
const DEFAULT_MAX_OPERATIONS = 900;

/**
 * A Keyv store over Workers KV, for the caches of `@elysiumjs/mnemosyne`.
 *
 * The KV namespace is read from the current invocation on every call, so the store holds no
 * binding between invocations. KV is eventually consistent, and entries expire after at least
 * 60 seconds: shorter TTLs are rounded up.
 *
 * @example
 * ```ts
 * MnemosyneModule.with({
 * 	cache: { redis: false, stores: { kv: () => new KeyvWorkersKV({ binding: 'CACHE' }) } }
 * });
 * ```
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class KeyvWorkersKV {
	public namespace: string | undefined;
	readonly #binding: string;
	readonly #separator: string;
	readonly #maxOperations: number;
	readonly #listeners = new Map<string, Array<(...args: any[]) => void>>();

	constructor(options: KeyvWorkersKVOptions) {
		this.#binding = options.binding;
		this.namespace = options.namespace;
		this.#separator = options.keyPrefixSeparator ?? '::';
		this.#maxOperations = Math.max(2, options.maxOperations ?? DEFAULT_MAX_OPERATIONS);
	}

	public get opts() {
		return {
			dialect: 'workers-kv',
			binding: this.#binding,
			namespace: this.namespace,
			keyPrefixSeparator: this.#separator
		};
	}

	public on(event: string, listener: (...args: any[]) => void): this {
		this.#listeners.set(event, [...(this.#listeners.get(event) ?? []), listener]);
		return this;
	}

	public async get<Value>(key: string): Promise<Value | undefined> {
		const value = await this.#kv().get(this.#key(key), 'text');
		return value === null ? undefined : (value as Value);
	}

	public async getMany<Value>(keys: string[]): Promise<Array<Value | undefined>> {
		return Promise.all(keys.map((key) => this.get<Value>(key)));
	}

	public async has(key: string): Promise<boolean> {
		return (await this.get(key)) !== undefined;
	}

	public async set(key: string, value: unknown, ttl?: number): Promise<void> {
		const options = ttl
			? { expirationTtl: Math.max(MIN_TTL_SECONDS, Math.ceil(ttl / 1000)) }
			: undefined;
		await this.#kv().put(this.#key(key), String(value), options);
	}

	public async setMany(entries: Array<{ key: string; value: unknown; ttl?: number }>) {
		await Promise.all(entries.map(({ key, value, ttl }) => this.set(key, value, ttl)));
	}

	/**
	 * Deletes a key. It reads first, because the Keyv contract returns whether the key existed;
	 * on eventually consistent KV this answer is best-effort.
	 */
	public async delete(key: string): Promise<boolean> {
		const existed = await this.has(key);
		await this.#kv().delete(this.#key(key));
		return existed;
	}

	public async deleteMany(keys: string[]): Promise<boolean> {
		const deleted = await Promise.all(keys.map((key) => this.delete(key)));
		return deleted.some(Boolean);
	}

	/**
	 * Deletes every key of the namespace, or every key of the KV namespace without one, within the
	 * `maxOperations` budget. When the budget runs out, the keys left are logged as a warning and
	 * stay for the next `clear()`.
	 */
	public async clear(): Promise<void> {
		const kv = this.#kv();
		const prefix = this.namespace ? `${this.namespace}${this.#separator}` : undefined;
		let budget = this.#maxOperations;
		// The pages are listed before deleting, so that deletions do not move the cursor. Listing
		// stops once the keys found use up the rest of the budget.
		const names: string[] = [];
		let cursor: string | undefined;
		do {
			const page = await kv.list({ prefix, cursor });
			budget--;
			names.push(...page.keys.map(({ name }) => name));
			cursor = page.list_complete ? undefined : page.cursor;
		} while (cursor && budget > names.length + 1);

		const deleting = names.slice(0, Math.max(0, budget));
		for (let i = 0; i < deleting.length; i += KV_DELETE_CHUNK) {
			await Promise.all(deleting.slice(i, i + KV_DELETE_CHUNK).map((name) => kv.delete(name)));
		}

		const left = names.length - deleting.length;
		if (left > 0 || cursor) {
			getLogger().warn('KV clear() stopped at its operation budget; call it again for the rest', {
				binding: this.#binding,
				namespace: this.namespace,
				deleted: deleting.length,
				remaining: cursor ? `${left} listed, more not listed` : left,
				maxOperations: this.#maxOperations
			});
		}
	}

	#kv(): WorkersKVNamespace {
		return Workers.binding<WorkersKVNamespace>(this.#binding);
	}

	#key(key: string): string {
		return this.namespace ? `${this.namespace}${this.#separator}${key}` : key;
	}
}
