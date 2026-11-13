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

import { getLogger, Json, Service } from '../index';
import { Cache } from './cache';
import { getCurrentTenant, getTenancyConfig } from './tenancy';

/** Name of the global service holding the default cache options of the repositories. */
export const REPOSITORY_CACHE_SERVICE = 'mnemosyne.repositories.cache';

/** How long a cached row is kept when no `ttl` is given: one hour. */
export const DEFAULT_REPOSITORY_CACHE_TTL = 3_600_000;

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

	/** How long a row is kept, in milliseconds, above 0. Defaults to one hour. */
	ttl?: number;
};

/** The cache options of a repository class, resolved. */
type Resolved = { store: string; ttl: number };

/** A cached row, with the generation and the version of its row it was read in. */
type Entry = { g: string; v: string; value: unknown };

/** A cached key lookup of `findBy()`, with the generation it was read in. */
type Lookup = { g: string; key: Record<string, unknown> };

/** The model a repository cache works for. */
type CachedModel = { modelName: string; schemaHash: string; supportTenancy: boolean };

/** Stores already reported as unavailable, so that each is logged once. */
const reported = new Set<string>();

/** Models whose rows were found not to survive `Json`, so that each is logged once. */
const unkept = new Set<string>();

/**
 * The stores the repositories of each model cache in, with the longest TTL of each: writes forget
 * in every one, and versions outlive the longest-lived entry.
 */
const known = new Map<string, Map<string, number>>();

/** Remembers the store and TTL of a repository of a model. */
const remember = (modelName: string, options: Resolved): void => {
	const stores = known.get(modelName) ?? new Map<string, number>();
	stores.set(options.store, Math.max(stores.get(options.store) ?? 0, options.ttl));
	known.set(modelName, stores);
};

/** The default cache options of the module, if any. */
const defaults = (): RepositoryCacheOptions | undefined => {
	try {
		return Service.get<RepositoryCacheOptions>(REPOSITORY_CACHE_SERVICE) ?? undefined;
	} catch {
		return undefined;
	}
};

/** Merges cache options over the defaults, with the default store and TTL. */
const complete = (options: RepositoryCacheOptions): Resolved => {
	const ttl = options.ttl ?? DEFAULT_REPOSITORY_CACHE_TTL;
	return {
		store: options.store ?? 'memory',
		ttl: Number.isFinite(ttl) && ttl > 0 ? ttl : DEFAULT_REPOSITORY_CACHE_TTL
	};
};

/**
 * The cache a repository class reads through: its own `static cache` over the defaults of the
 * `MnemosyneModule`. `false` turns reading off; without either, the repository does not cache.
 */
const readOptions = (repository: Function): Resolved | undefined => {
	const own = (repository as unknown as { cache?: RepositoryCacheOptions | false }).cache;
	if (own === false) return undefined;
	const base = defaults();
	if (!own && !base) return undefined;
	return complete({ ...base, ...own });
};

/**
 * The cache a repository class forgets its writes in: the one it reads through, or the
 * defaults of the module when it does not read through one, so that a repository that does not
 * cache still forgets what other repositories of its model cached.
 */
const writeOptions = (repository: Function): Resolved | undefined => {
	const read = readOptions(repository);
	if (read) return read;
	const own = (repository as unknown as { cache?: RepositoryCacheOptions | false }).cache;
	const base = defaults();
	if (own && typeof own === 'object') return complete({ ...base, ...own });
	return base ? complete(base) : undefined;
};

/** The store of resolved options, or `undefined`, logged once, when it is not available. */
const storeOf = (options: Resolved): Omit<CacheInterface, 'tags'> | undefined => {
	try {
		const cache = options.store === 'memory' ? Cache.memory : Cache.store(options.store);
		return cache.tags('repositories');
	} catch (error) {
		if (!reported.has(options.store)) {
			reported.add(options.store);
			getLogger().warn(
				`The repository cache "${options.store}" is not available: rows are read from the database.`,
				{ error }
			);
		}
		return undefined;
	}
};

/**
 * The read-through cache of a repository: rows by key, and the keys of `findBy()` lookups, per
 * model, digest of its columns, tenant and connection.
 *
 * Each row has a version, and each tenant's rows a generation, kept next to the entries. A
 * cached row is a hit only while both are the ones it was read with: an update or delete of the
 * row changes its version, and the writes without events change the generation. A read that
 * started before a write therefore never leaves the row it read in the cache, since it is
 * stamped with the version it saw. Versions and generations live twice as long as the entries,
 * the longest TTL of the model's entries, so that none expires before the entries stamped with
 * it, and a read writes its row only when no write changed them while it loaded.
 *
 * A cache that fails, or that is not available, costs a read of the database, never the call,
 * and is logged.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class RepositoryCache {
	private constructor(
		private readonly cache: Omit<CacheInterface, 'tags'>,
		private readonly ttl: number,
		private readonly prefix: string,
		private readonly modelName: string,
		private readonly store: string
	) {}

	/** How long versions and generations live: twice the longest TTL of the model's entries. */
	private get stampTtl(): number {
		const longest = known.get(this.modelName)?.get(this.store) ?? 0;
		return Math.max(this.ttl, longest) * 2;
	}

	/** Creates the cache of resolved options for a model and connection. */
	private static make(
		options: Resolved | undefined,
		model: CachedModel,
		connection: string
	): RepositoryCache | undefined {
		if (!options) return undefined;
		const cache = storeOf(options);
		if (!cache) return undefined;
		// Rows of a model without tenancy are shared by every tenant, unless rows are isolated by
		// row-level security, where what a read finds depends on the tenant.
		const shared = !model.supportTenancy && getTenancyConfig().mode !== 'rls';
		const tenant = shared ? '*' : (getCurrentTenant() ?? 'public');
		const prefix = Json.stringify([model.modelName, model.schemaHash, tenant, connection]);
		remember(model.modelName, options);
		return new RepositoryCache(cache, options.ttl, prefix, model.modelName, options.store);
	}

	/**
	 * The cache a repository class reads through, or `undefined` when it does not cache.
	 * @param repository The repository class.
	 * @param model The model.
	 * @param connection The connection name.
	 */
	public static reading(
		repository: Function,
		model: CachedModel,
		connection: string
	): RepositoryCache | undefined {
		return RepositoryCache.make(readOptions(repository), model, connection);
	}

	/**
	 * Remembers the cache a repository class reads through, so that the writes of every repository
	 * of its model forget in it, even before it first reads.
	 * @param repository The repository class.
	 * @param model The model.
	 */
	public static remember(repository: Function, model: CachedModel): void {
		const options = readOptions(repository);
		if (options) remember(model.modelName, options);
	}

	/**
	 * The caches the writes of a repository class forget in: its own, the defaults of the module,
	 * and every store a repository of its model caches in. `undefined` when there is none.
	 * @param repository The repository class, or `undefined` for writes outside a repository.
	 * @param model The model.
	 * @param connection The connection name.
	 */
	public static writing(
		repository: Function | undefined,
		model: CachedModel,
		connection: string
	): RepositoryCacheWriter | undefined {
		const own = repository ? writeOptions(repository) : undefined;
		const base = defaults();
		const all = new Map<string, Resolved>();
		for (const options of [own, base ? complete(base) : undefined]) {
			if (options) all.set(options.store, options);
		}
		for (const [store, ttl] of known.get(model.modelName) ?? []) {
			if (!all.has(store)) all.set(store, { store, ttl });
		}
		const caches = [...all.values()]
			.map((options) => RepositoryCache.make(options, model, connection))
			.filter((cache): cache is RepositoryCache => cache !== undefined);
		return caches.length > 0 ? new RepositoryCacheWriter(caches) : undefined;
	}

	/** Reads the generation and the version of a row: what an entry read now is stamped with. */
	private async stampOf(
		key: Record<string, unknown> | undefined
	): Promise<{ g: string; v: string }> {
		const [generation, version] = await this.cache.mget<unknown>(
			key ? [this.generationKey, this.versionKey(key)] : [this.generationKey]
		);
		return {
			g: (generation as string | undefined) ?? '0',
			v: (version as string | undefined) ?? '0'
		};
	}

	/** Whether a row read from the database can be cached as it is: `Json` keeps it. */
	private keeps(row: unknown): boolean {
		// The columns of an instance: the instance itself is always kept as its model and columns.
		if (Json.survives({ ...(row as object) })) return true;
		if (!unkept.has(this.modelName)) {
			unkept.add(this.modelName);
			getLogger().warn(
				`Rows of ${this.modelName} hold values Json cannot keep: they are read from the database.`
			);
		}
		return false;
	}

	private rowKey(key: Record<string, unknown>): string {
		return `${this.prefix}:row:${Json.stringify(Object.values(key))}`;
	}

	private versionKey(key: Record<string, unknown>): string {
		return `${this.prefix}:version:${Json.stringify(Object.values(key))}`;
	}

	private lookupKey(column: string, value: unknown): string {
		return `${this.prefix}:by:${column}:${Json.stringify(value)}`;
	}

	private get generationKey(): string {
		return `${this.prefix}:generation`;
	}

	/** Logs a cache that failed. */
	private failed(action: string, error: unknown): void {
		getLogger().warn(`The repository cache failed to ${action}.`, { error });
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
		const rowKey = this.rowKey(key);
		let stamp: { g: string; v: string } | undefined;
		try {
			const [entry, generation, version] = await this.cache.mget<unknown>([
				rowKey,
				this.generationKey,
				this.versionKey(key)
			]);
			stamp = {
				g: (generation as string | undefined) ?? '0',
				v: (version as string | undefined) ?? '0'
			};
			const cached = entry as Entry | undefined;
			if (cached && cached.g === stamp.g && cached.v === stamp.v) return cached.value as T;
		} catch (error) {
			this.failed('read a row', error);
		}
		const row = await load();
		if (row !== null && stamp && this.keeps(row)) {
			try {
				// A write that ran during the load changed a stamp: the row may be stale.
				const now = await this.stampOf(key);
				if (now.g === stamp.g && now.v === stamp.v) {
					await this.cache.set(rowKey, { ...stamp, value: row }, this.ttl);
				}
			} catch (error) {
				this.failed('write a row', error);
			}
		}
		return row;
	}

	/**
	 * Reads the first row whose column has a value through the cache: the key of the row is
	 * cached, and the row is read by its key, then checked against the value. Made for unique
	 * columns: for others, the cached row stays the answer while it keeps the value.
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
		const lookupKey = this.lookupKey(column, value);
		let generation: string | undefined;
		try {
			const [entry, current] = await this.cache.mget<unknown>([lookupKey, this.generationKey]);
			generation = (current as string | undefined) ?? '0';
			const lookup = entry as Lookup | undefined;
			if (lookup && lookup.g === generation) {
				const row = await find(lookup.key);
				// The row may have changed its value since: the lookup is then a miss.
				if (row !== null && sameValue((row as Record<string, unknown>)[column], value)) return row;
			}
		} catch (error) {
			this.failed('read a lookup', error);
		}
		const row = await load();
		if (row !== null && generation !== undefined) {
			try {
				if ((await this.stampOf(undefined)).g !== generation) return row;
				await this.cache.set(lookupKey, { g: generation, key: keyOf(row) }, this.ttl);
			} catch (error) {
				this.failed('write a lookup', error);
			}
		}
		return row;
	}

	/**
	 * Gives the row of a key a new version, which makes its cached entry, and any entry a read
	 * running meanwhile writes, a miss.
	 * @param key The key column values.
	 */
	public async forget(key: Record<string, unknown>): Promise<void> {
		try {
			await this.cache.set(this.versionKey(key), crypto.randomUUID(), this.stampTtl);
			await this.cache.del(this.rowKey(key));
		} catch (error) {
			this.failed('forget a row', error);
		}
	}

	/** Gives the tenant's rows a new generation, which makes every cached row a miss. */
	public async invalidate(): Promise<void> {
		try {
			await this.cache.set(this.generationKey, crypto.randomUUID(), this.stampTtl);
		} catch (error) {
			this.failed('forget the rows', error);
		}
	}
}

/**
 * Forgets writes in every cache of a model.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class RepositoryCacheWriter {
	public constructor(private readonly caches: RepositoryCache[]) {}

	/**
	 * Gives the row of a key a new version in every cache.
	 * @param key The key column values.
	 */
	public async forget(key: Record<string, unknown>): Promise<void> {
		await Promise.all(this.caches.map((cache) => cache.forget(key)));
	}

	/** Gives the tenant's rows a new generation in every cache. */
	public async invalidate(): Promise<void> {
		await Promise.all(this.caches.map((cache) => cache.invalidate()));
	}
}

/** Whether a column value read back equals the value looked up. */
const sameValue = (a: unknown, b: unknown): boolean =>
	a === b || Json.stringify(a) === Json.stringify(b);
