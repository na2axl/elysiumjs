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

import type { CacheInterface } from './cache';

import { Json, Service } from '../index';
import { Cache } from './cache';
import { getCurrentTenant } from './tenancy';

/** Name of the global service holding the default cache options of the repositories. */
export const REPOSITORY_CACHE_SERVICE = 'mnemosyne.repositories.cache';

/**
 * How a repository caches its rows.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type RepositoryCacheOptions = {
	/**
	 * The cache: `memory` for `Cache.memory`, or the name of a store given in
	 * `MnemosyneModule.with({ cache: { stores } })`. Defaults to `memory`.
	 */
	store?: 'memory' | (string & {});

	/** How long a row is kept, in milliseconds. Defaults to the store's own TTL. */
	ttl?: number;
};

/** The resolved cache of a repository class. */
type Resolved = { store: string; ttl?: number };

/** The key of the generation of a tenant's rows, changed by the writes without events. */
const GENERATION = '$generation';

/** A cached row, with the generation it was read in. */
type Entry = { g: string; value: unknown };

/** A cached key lookup of `findBy()`, with the generation it was read in. */
type Lookup = { g: string; key: Record<string, unknown> };

/**
 * The cache options of a repository class: its own `static cache` over the defaults of the
 * `MnemosyneModule`. `false` turns caching off; without either, the repository does not cache.
 */
const resolve = (repository: Function): Resolved | undefined => {
	const own = (repository as unknown as { cache?: RepositoryCacheOptions | false }).cache;
	if (own === false) return undefined;
	let defaults: RepositoryCacheOptions | null = null;
	try {
		defaults = Service.get<RepositoryCacheOptions>(REPOSITORY_CACHE_SERVICE);
	} catch {
		defaults = null;
	}
	if (!own && !defaults) return undefined;
	const options = { ...defaults, ...own };
	return { store: options.store ?? 'memory', ttl: options.ttl };
};

/**
 * The read-through cache of a repository: rows by key, and the keys of `findBy()` lookups,
 * per model, schema, tenant and connection. Updates and deletes forget their row, now and once
 * the unit of work commits; the writes without events change the generation of the tenant's
 * rows, which makes every entry read before them a miss. Reads skip the cache while a unit of
 * work or a transaction is open, so that it never holds rows that may roll back. A cache that
 * fails costs a read of the database, never the call.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class RepositoryCache {
	private constructor(
		private readonly cache: Omit<CacheInterface, 'tags'>,
		private readonly ttl: number | undefined,
		private readonly prefix: string
	) {}

	/**
	 * The cache of a repository class, or `undefined` when it does not cache.
	 * @param repository The repository class.
	 * @param model The model name and schema hash.
	 * @param connection The connection name.
	 */
	public static for(
		repository: Function,
		model: { modelName: string; schemaHash: string },
		connection: string
	): RepositoryCache | undefined {
		const options = resolve(repository);
		if (!options) return undefined;
		const store = options.store === 'memory' ? Cache.memory : Cache.store(options.store);
		const tenant = getCurrentTenant() ?? 'public';
		return new RepositoryCache(
			store.tags(`model:${model.modelName}`),
			options.ttl,
			`${model.schemaHash}:${tenant}:${connection}:`
		);
	}

	/** The cache key of a row key. */
	private rowKey(key: Record<string, unknown>): string {
		return `${this.prefix}row:${Json.stringify(Object.values(key))}`;
	}

	/** The cache key of a `findBy()` lookup. */
	private lookupKey(column: string, value: unknown): string {
		return `${this.prefix}by:${column}:${Json.stringify(value)}`;
	}

	/** The generation key of the tenant's rows. */
	private get generationKey(): string {
		return `${this.prefix}${GENERATION}`;
	}

	/** Reads entries with the current generation, or `undefined` when the cache fails. */
	private async read<T extends { g: string }>(
		key: string
	): Promise<{ entry: T | undefined; generation: string } | undefined> {
		try {
			const [entry, current] = await this.cache.mget<unknown>([key, this.generationKey]);
			if (typeof current === 'string')
				return { entry: entry as T | undefined, generation: current };
			// No generation yet, or it expired: a new one, so that no entry read before comes back.
			const generation = crypto.randomUUID();
			await this.cache.set(this.generationKey, generation);
			return { entry: undefined, generation };
		} catch {
			return undefined;
		}
	}

	/** Writes an entry, ignoring a cache that fails. */
	private async write(key: string, value: unknown): Promise<void> {
		try {
			await this.cache.set(key, value, this.ttl);
		} catch {
			// The next read goes to the database.
		}
	}

	/**
	 * Reads a row by its key through the cache.
	 * @param key The key column values.
	 * @param load Reads the row from the database.
	 */
	public async find<T>(
		key: Record<string, unknown>,
		load: () => Promise<T | null>
	): Promise<T | null> {
		const cacheKey = this.rowKey(key);
		const read = await this.read<Entry>(cacheKey);
		if (read?.entry && read.entry.g === read.generation) return read.entry.value as T;
		const row = await load();
		if (row !== null && read) await this.write(cacheKey, { g: read.generation, value: row });
		return row;
	}

	/**
	 * Reads the first row whose column has a value through the cache: the key of the row is
	 * cached, and the row is read by its key, then checked against the value.
	 * @param column The column.
	 * @param value The value.
	 * @param keyOf The key column values of a row.
	 * @param find Reads a row by its key, through the cache.
	 * @param load Reads the row from the database.
	 */
	public async findBy<T>(
		column: string,
		value: unknown,
		keyOf: (row: T) => Record<string, unknown>,
		find: (key: Record<string, unknown>) => Promise<T | null>,
		load: () => Promise<T | null>
	): Promise<T | null> {
		const cacheKey = this.lookupKey(column, value);
		const read = await this.read<Lookup>(cacheKey);
		if (read?.entry && read.entry.g === read.generation) {
			const row = await find(read.entry.key);
			// The row may have changed its value since: the lookup is then a miss.
			if (row !== null && sameValue((row as Record<string, unknown>)[column], value)) return row;
		}
		const row = await load();
		if (row !== null && read) {
			const key = keyOf(row);
			await this.write(cacheKey, { g: read.generation, key });
			await this.write(this.rowKey(key), { g: read.generation, value: row });
		}
		return row;
	}

	/**
	 * Forgets the row of a key.
	 * @param key The key column values.
	 */
	public async forget(key: Record<string, unknown>): Promise<void> {
		try {
			await this.cache.del(this.rowKey(key));
		} catch {
			// The entry expires with its TTL.
		}
	}

	/** Makes every entry of the tenant's rows read before now a miss. */
	public async invalidate(): Promise<void> {
		try {
			await this.cache.set(this.generationKey, crypto.randomUUID());
		} catch {
			// The entries expire with their TTL.
		}
	}
}

/** Whether a column value read back equals the value looked up. */
const sameValue = (a: unknown, b: unknown): boolean =>
	a === b ||
	(a instanceof Date && b instanceof Date && a.getTime() === b.getTime()) ||
	Json.stringify(a) === Json.stringify(b);
