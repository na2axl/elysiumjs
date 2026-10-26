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

import type { KeyvStoreAdapter } from 'cacheable';
import type { KeyvEntry, StoredData } from 'keyv';

import { EventEmitter } from 'node:events';

import { Event, Redis, Service } from '@elysiumjs/core';

/**
 * Keyv adapter for redis. This adapter is based on the Bun's Redis client.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class KeyvRedis extends EventEmitter implements KeyvStoreAdapter {
	#client?: Bun.RedisClient;
	#namespace: string | undefined;
	#keyPrefixSeparator = '::';
	#clearBatchSize = 1000;
	#useUnlink = true;
	#noNamespaceAffectsAll = false;

	#connection: string;

	constructor(props: {
		/**
		 * The Redis connection to use.
		 */
		connection: string;

		/**
		 * Namespace for the connection.
		 */
		namespace?: string;

		/**
		 * Separator to use between namespace and key.
		 */
		keyPrefixSeparator?: string;

		/**
		 * Number of keys to delete in a single batch.
		 */
		clearBatchSize?: number;

		/**
		 * Use UNLINK instead of DEL to delete keys. UNLINK frees memory in the background (Redis 4+).
		 */
		useUnlink?: boolean;

		/**
		 * Whether to allow clearing all keys when no namespace is set.
		 * If set to true and no namespace is set, iterate() will return all keys.
		 * Defaults to `false`.
		 */
		noNamespaceAffectsAll?: boolean;
	}) {
		super();

		this.#connection = props.connection;
		this.#namespace = props.namespace;
		this.#keyPrefixSeparator = props.keyPrefixSeparator ?? '::';
		this.#clearBatchSize = props.clearBatchSize ?? 1000;
		this.#useUnlink = props.useUnlink ?? true;
		this.#noNamespaceAffectsAll = props.noNamespaceAffectsAll ?? false;

		this.on('error', (error) => {
			Event.emit('elysium:error', error);
		});
	}

	/**
	 * Resolves the Redis client on first use. The async path is always safe, even when the
	 * Redis module has not been initialised yet (lazy boot).
	 */
	protected async getClient(): Promise<Bun.RedisClient> {
		this.#client ??= await Service.resolve<Bun.RedisClient>(
			Redis.getConnectionName(this.#connection)
		);
		return this.#client;
	}

	/**
	 * Get the options for the adapter.
	 */
	public get opts() {
		return {
			namespace: this.#namespace,
			keyPrefixSeparator: this.#keyPrefixSeparator,
			clearBatchSize: this.#clearBatchSize,
			noNamespaceAffectsAll: this.#noNamespaceAffectsAll,
			dialect: 'redis',
			url: this.#connection
		};
	}

	/**
	 * Gets the namespace for the adapter. If undefined, it will not use a namespace including keyPrefixing.
	 * @default undefined
	 */
	public get namespace(): string | undefined {
		return this.#namespace;
	}

	/**
	 * Sets the namespace for the adapter. If undefined, it will not use a namespace including keyPrefixing.
	 */
	public set namespace(value: string | undefined) {
		this.#namespace = value;
	}

	public async get<Value>(key: string): Promise<StoredData<Value> | undefined> {
		const client = await this.getClient();
		key = this.createKeyPrefix(key, this.#namespace);
		const value = await client.get(key);

		return value === null ? undefined : (value as Value);
	}

	public async set(key: string, value: any, ttl?: number) {
		const client = await this.getClient();
		key = this.createKeyPrefix(key, this.#namespace);

		if (ttl) {
			await client.set(key, value, 'PX', ttl);
		} else {
			await client.set(key, value);
		}
	}

	public async setMany(values: Array<KeyvEntry>): Promise<void> {
		const client = await this.getClient();
		// Bun's RedisClient has no MULTI support, and sending a raw MULTI on the shared,
		// auto-pipelined client would wrap other callers' commands in the transaction. The SETs
		// are pipelined instead, without atomicity.
		const multi = [];

		for (const { key, value, ttl } of values) {
			const prefixedKey = this.createKeyPrefix(key, this.#namespace);
			if (ttl) {
				// eslint-disable-next-line @typescript-eslint/naming-convention, @typescript-eslint/no-unsafe-argument
				multi.push(client.set(prefixedKey, value, 'PX', ttl));
			} else {
				// eslint-disable-next-line @typescript-eslint/no-unsafe-argument
				multi.push(client.set(prefixedKey, value));
			}
		}

		await Promise.all(multi);
	}

	public async delete(key: string): Promise<boolean> {
		const client = await this.getClient();
		key = this.createKeyPrefix(key, this.#namespace);
		const deleted = await this.#remove(client, [key]);

		return deleted > 0;
	}

	public async clear(): Promise<void> {
		try {
			const client = await this.getClient();

			if (!this.#namespace && this.#noNamespaceAffectsAll) {
				await client.send('FLUSHDB', []);
				return;
			}

			let cursor = '0';
			const batchSize = this.#clearBatchSize;
			const match = this.#namespace ? `${this.#namespace}${this.#keyPrefixSeparator}*` : '*';

			do {
				const result = await client.send('SCAN', [
					cursor,
					'MATCH',
					match,
					'COUNT',
					batchSize.toString(),
					'TYPE',
					'string'
				]);

				// Parse the result
				let [newCursor, keys] = result;
				cursor = newCursor.toString();

				if (keys.length === 0) {
					continue;
				}

				if (!this.#namespace) {
					keys = keys.filter((key: string) => !key.includes(this.#keyPrefixSeparator));
				}

				if (keys.length > 0) await this.#remove(client, keys);
			} while (cursor !== '0');
		} catch (error) {
			this.emit('error', error);
		}
	}

	public async has(key: string): Promise<boolean> {
		const client = await this.getClient();
		key = this.createKeyPrefix(key, this.#namespace);
		return client.exists(key);
	}

	public async hasMany(keys: string[]): Promise<boolean[]> {
		const client = await this.getClient();
		// Pipelined rather than in a MULTI, which Bun's RedisClient does not support.
		const multi = [];

		for (const key of keys) {
			const prefixedKey = this.createKeyPrefix(key, this.#namespace);
			multi.push(client.exists(prefixedKey));
		}

		return Promise.all(multi);
	}

	public async getMany<Value>(keys: string[]): Promise<Array<StoredData<Value | undefined>>> {
		const client = await this.getClient();
		if (keys.length === 0) {
			return [];
		}

		keys = keys.map((key) => this.createKeyPrefix(key, this.#namespace));
		const values = await client.mget(...keys);

		return values as Value[];
	}

	public async disconnect(): Promise<void> {
		// The connection is owned by the Redis module; only drop our reference to it.
		this.#client = undefined;
	}

	public async deleteMany(keys: string[]): Promise<boolean> {
		if (keys.length === 0) return false;

		const client = await this.getClient();
		const prefixedKeys = keys.map((key) => this.createKeyPrefix(key, this.#namespace));

		return (await this.#remove(client, prefixedKeys)) > 0;
	}

	/**
	 * Deletes keys in a single command, with UNLINK or DEL depending on the options.
	 * @param client The Redis client.
	 * @param keys The keys to delete, already prefixed.
	 * @returns The number of keys deleted.
	 */
	#remove(client: Bun.RedisClient, keys: string[]): Promise<number> {
		return this.#useUnlink ? client.unlink(...keys) : client.del(...keys);
	}

	public async *iterator<Value>(
		namespace?: string
	): AsyncGenerator<Array<string | Awaited<Value> | undefined>, void> {
		const client = await this.getClient();
		const match = namespace ? `${namespace}${this.#keyPrefixSeparator}*` : '*';
		let cursor = '0';

		do {
			const result = await client.send('SCAN', [cursor, 'MATCH', match, 'TYPE', 'string']);

			// Parse the result
			let [newCursor, keys] = result;
			cursor = newCursor.toString();

			if (!namespace && !this.#noNamespaceAffectsAll) {
				keys = keys.filter((key: string) => !key.includes(this.#keyPrefixSeparator));
			}

			if (keys.length > 0) {
				const values = await client.mget(...keys);
				for (const i of keys.keys()) {
					const key = this.getKeyWithoutPrefix(keys[i], namespace);
					const value = values[i];
					yield [key, value!];
				}
			}
		} while (cursor !== '0');
	}

	/**
	 * Helper function to create a key with a namespace.
	 * @param key The key to prefix.
	 * @param namespace The namespace to prefix the key with.
	 * @returns The key with the namespace such as 'namespace::key'.
	 */
	public createKeyPrefix(key: string, namespace?: string): string {
		return !!namespace ? `${namespace}${this.#keyPrefixSeparator}${key}` : key;
	}

	/**
	 * Helper function to remove the namespace from a key.
	 * @param key The key to remove the namespace from.
	 * @param namespace The namespace to remove from the key.
	 * @returns The key without the namespace.
	 */
	public getKeyWithoutPrefix(key: string, namespace?: string): string {
		return !!namespace ? key.replace(`${namespace}${this.#keyPrefixSeparator}`, '') : key;
	}
}
