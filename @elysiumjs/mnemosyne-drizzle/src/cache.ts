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

import type { CacheInterface } from '@elysiumjs/mnemosyne';
import type { CacheConfig } from 'drizzle-orm/cache/core/types';

import { AsyncLocalStorage } from 'node:async_hooks';

import { Service, ServiceNotReadyError } from '@elysiumjs/core';
import { createDatabaseCacheStorage, getCurrentTenant } from '@elysiumjs/mnemosyne';
import { getTableName, is, Table } from 'drizzle-orm';
import { Cache as DrizzleCache } from 'drizzle-orm/cache/core';

/**
 * Default time to live of cached query results, in seconds.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export const DEFAULT_CACHE_TTL = 60;

/**
 * Time to live of the table version tokens, in milliseconds. A version that expires is replaced
 * by a new token on the next read, which only causes cache misses.
 */
const VERSION_TTL = 24 * 60 * 60 * 1000;

/** Most misses of a key kept waiting for their `put` before the oldest is dropped. */
const MAX_PENDING_PER_KEY = 16;

/** Most keys with misses waiting for their `put` before the least recent is dropped. */
const MAX_PENDING_KEYS = 1000;

/** A cached query result, with the table versions it was read at. */
type Entry = { v: string; r: unknown[] };

/** A cache miss waiting for the result of its query. */
type Pending = { signature: string; versionKeys: string[]; at: number };

/** Tables and tags mutated inside a transaction, invalidated once it commits. */
type TransactionScope = { tables: Set<string>; tags: Set<string> };

/** The symbol under which Drizzle stores the schema of a table. */
const TABLE_SCHEMA = Symbol.for('drizzle:Schema');

/** Gets the name Drizzle uses for a table in cache metadata: `schema.name`, or `name`. */
const tableKey = (table: string | Table): string => {
	if (!is(table, Table)) return table as string;
	const schema = (table as unknown as Record<symbol, string | undefined>)[TABLE_SCHEMA];
	return schema ? `${schema}.${getTableName(table)}` : getTableName(table);
};

/** Wraps a single value or a list in a list. */
const toArray = <T>(value: T | T[] | undefined): T[] =>
	value === undefined ? [] : Array.isArray(value) ? value : [value];

/**
 * Drizzle query cache backed by the framework's cache storage.
 *
 * - Results are cached per connection and tenant: every key starts with the configured prefix
 *   (if any) and the connection name, result keys include the current tenant (or `public`), and
 *   tags are invalidated for the current tenant. Each connection has its own transaction scope.
 * - Invalidation works across application instances sharing the cache store: each table has a
 *   version token in the store, every result records the versions it was read at, and a mutation
 *   replaces the versions of the tables it touches. Table versions are shared by all tenants, as
 *   a mutation made for one tenant can change rows other tenants read (shared tables, RLS
 *   bypass). Every key is written with a TTL.
 * - A result is only stored when the table versions are still the ones its query started at, and
 *   every concurrent miss of the key read the same versions: Drizzle does not pair a `put` with its
 *   `get`, so a result that may predate a mutation is never stored.
 * - Inside a transaction, the cache is neither read nor written, since the transaction may read
 *   its own uncommitted changes. Tables mutated in a transaction are invalidated once it commits,
 *   and not at all when it rolls back.
 *
 * Remaining race: a mutation run outside a transaction is invalidated while its statement runs
 * (Drizzle starts both together), so a read on another connection that completes between the
 * invalidation and the commit can cache the previous rows until their TTL expires. Mutations run
 * in a transaction (including RLS-scoped repository calls) are invalidated after the commit and
 * are not affected.
 *
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class DrizzleDatabaseCache extends DrizzleCache {
	#storageEngine: 'redis' | 'memory';
	#cache?: Omit<CacheInterface, 'tags'>;
	#cacheStrategy: 'explicit' | 'all';
	#globalTtl: number;
	#keyPrefix: string;

	/** The transaction open on this cache's connection in the current async context, if any. */
	#transactionScope = new AsyncLocalStorage<TransactionScope>();

	/**
	 * The versions read by `get` for each missed key, oldest first, checked by the following `put`.
	 * Misses are removed by `put`, and dropped once older than the TTL (failed queries never call
	 * `put`). Both the misses of a key and the number of keys are capped.
	 */
	#pending = new Map<string, Pending[]>();

	/**
	 * @param cacheStrategy Whether queries are cached only when they opt in (`explicit`), or always.
	 * @param globalTtl The default time to live of cached results, in seconds.
	 * @param storageEngine The cache storage to use.
	 * @param connectionName The name of the connection, which prefixes every key.
	 * @param prefix A prefix for every key, before the connection name (empty for none).
	 */
	constructor(
		cacheStrategy: 'explicit' | 'all' = 'explicit',
		globalTtl: number = DEFAULT_CACHE_TTL,
		storageEngine: 'redis' | 'memory' = 'redis',
		connectionName: string = 'default',
		prefix: string = ''
	) {
		super();
		this.#cacheStrategy = cacheStrategy;
		this.#globalTtl = globalTtl;
		this.#storageEngine = storageEngine;
		this.#keyPrefix = prefix ? `${prefix}:${connectionName}` : connectionName;
	}

	/**
	 * Resolves the cache storage on first use rather than at construction, so that a connection
	 * can be built before the module providing the cache has finished initialising.
	 */
	async #storage(): Promise<Omit<CacheInterface, 'tags'>> {
		if (this.#cache) return this.#cache;
		try {
			this.#cache = createDatabaseCacheStorage({ storage: this.#storageEngine });
		} catch (error) {
			if (!(error instanceof ServiceNotReadyError)) throw error;
			await Service.resolve(error.service);
			this.#cache = createDatabaseCacheStorage({ storage: this.#storageEngine });
		}
		return this.#cache;
	}

	public override strategy(): 'explicit' | 'all' {
		return this.#cacheStrategy;
	}

	/**
	 * Runs a transaction so that the cache is bypassed inside it, and the tables it mutates are
	 * invalidated once it commits.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param run Opens and runs the transaction.
	 * @returns The return value of `run`.
	 */
	public async trackTransaction<T>(run: () => Promise<T>): Promise<T> {
		const scope: TransactionScope = { tables: new Set(), tags: new Set() };
		const result = await this.#transactionScope.run(scope, run);
		await this.#invalidate([...scope.tables], [...scope.tags]);
		return result;
	}

	public override async get(
		key: string,
		tables: string[] = [],
		isTag: boolean = false,
		autoInvalidate?: boolean
	): Promise<any[] | undefined> {
		if (this.#transactionScope.getStore()) return undefined;

		const storage = await this.#storage();
		const entryKey = this.#entryKey(key, isTag);
		const versionKeys =
			autoInvalidate === false ? [] : tables.map((table) => this.#versionKey(table));
		const [entry, ...versions] = await storage.mget<unknown>([entryKey, ...versionKeys]);

		const missing = versionKeys.flatMap((versionKey, index) =>
			versions[index] === undefined ? [{ index, versionKey }] : []
		);
		if (missing.length > 0) {
			// A fresh random token can never match an entry, so this only causes misses.
			const created = missing.map(({ versionKey }) => ({
				key: versionKey,
				value: crypto.randomUUID(),
				ttl: VERSION_TTL
			}));
			await storage.mset(created);
			for (const [i, { index }] of missing.entries()) versions[index] = created[i]!.value;
		}

		const signature = versions.join('|');
		const cached = entry as Entry | undefined;
		if (cached !== undefined && cached.v === signature) return cached.r;

		this.#remember(entryKey, { signature, versionKeys, at: Date.now() });
		return undefined;
	}

	public override async put(
		key: string,
		response: any,
		_tables: string[],
		isTag: boolean,
		config?: CacheConfig
	): Promise<void> {
		if (this.#transactionScope.getStore()) return;

		const entryKey = this.#entryKey(key, isTag);
		const pending = this.#live(entryKey);
		// Drizzle does not say which `get` this result belongs to. When the waiting misses read
		// different versions, a result may predate a mutation, so none of them is stored.
		if (pending.length === 0 || new Set(pending.map((miss) => miss.signature)).size > 1) {
			this.#pending.delete(entryKey);
			return;
		}
		const [miss, ...rest] = pending;
		if (rest.length > 0) this.#pending.set(entryKey, rest);
		else this.#pending.delete(entryKey);

		// A mutation since the query started makes the result outdated.
		const storage = await this.#storage();
		const current = await storage.mget<string>(miss!.versionKeys);
		if (current.join('|') !== miss!.signature) return;

		const signature = miss!.signature;
		const ttl = await this.#ttl(storage, entryKey, config);
		if (ttl <= 0) return;

		await storage.set<Entry>(entryKey, { v: signature, r: response }, ttl);
	}

	public override async onMutate(params: {
		tags?: string | string[];
		tables?: string | string[] | Table<any> | Table<any>[];
	}): Promise<void> {
		const tables = toArray<string | Table>(params.tables).map(tableKey);
		const tags = toArray(params.tags);

		const scope = this.#transactionScope.getStore();
		if (scope) {
			for (const table of tables) scope.tables.add(table);
			for (const tag of tags) scope.tags.add(tag);
			return;
		}

		await this.#invalidate(tables, tags);
	}

	/** Records a miss of a key, as the most recently used key. */
	#remember(entryKey: string, miss: Pending): void {
		const pending = [...this.#live(entryKey), miss].slice(-MAX_PENDING_PER_KEY);
		this.#pending.delete(entryKey);
		this.#pending.set(entryKey, pending);
		while (this.#pending.size > MAX_PENDING_KEYS) {
			this.#pending.delete(this.#pending.keys().next().value!);
		}
	}

	/** Gets the misses of a key that are not older than the TTL. */
	#live(entryKey: string): Pending[] {
		const since = Date.now() - this.#globalTtl * 1000;
		return (this.#pending.get(entryKey) ?? []).filter((miss) => miss.at >= since);
	}

	/** Replaces the versions of the given tables, and deletes the given tags for the tenant. */
	async #invalidate(tables: string[], tags: string[]): Promise<void> {
		if (tables.length === 0 && tags.length === 0) return;

		const storage = await this.#storage();
		if (tables.length > 0) {
			await storage.mset(
				tables.map((table) => ({
					key: this.#versionKey(table),
					value: crypto.randomUUID(),
					ttl: VERSION_TTL
				}))
			);
		}
		if (tags.length > 0) {
			await storage.mdel(tags.map((tag) => this.#entryKey(tag, true)));
		}
	}

	/**
	 * Computes the time to live of an entry, in milliseconds, from Drizzle's cache config: `px`,
	 * `ex`, `pxat`, `exat` and `keepTtl`, in that order of precedence, else the default TTL.
	 */
	async #ttl(
		storage: Omit<CacheInterface, 'tags'>,
		entryKey: string,
		config: CacheConfig | undefined
	): Promise<number> {
		if (config?.px !== undefined) return config.px;
		if (config?.ex !== undefined) return config.ex * 1000;
		if (config?.pxat !== undefined) return config.pxat - Date.now();
		if (config?.exat !== undefined) return config.exat * 1000 - Date.now();
		if (config?.keepTtl) {
			const expiresAt = await storage.ttl(entryKey);
			if (expiresAt !== undefined && expiresAt > Date.now()) return expiresAt - Date.now();
		}
		return this.#globalTtl * 1000;
	}

	/** Gets the key of a query result (or tag) for the connection and the current tenant. */
	#entryKey(key: string, isTag: boolean): string {
		const kind = isTag ? 'tag' : 'query';
		return `${this.#keyPrefix}:${kind}:${getCurrentTenant() ?? 'public'}:${key}`;
	}

	/** Gets the key of the version of a table of the connection. */
	#versionKey(table: string): string {
		return `${this.#keyPrefix}:version:${table}`;
	}
}
