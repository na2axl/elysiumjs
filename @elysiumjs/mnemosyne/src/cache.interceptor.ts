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

import type { Interceptor, InterceptorClass, InterceptorContext } from '@elysiumjs/core';
import type { CacheInterface } from './cache';

import { Cache } from './cache';

/**
 * Options of {@link CacheInterceptor.with}.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type CacheInterceptorOptions = {
	/** How long a response stays cached, in milliseconds. */
	ttl: number;

	/**
	 * The cache: `memory` (the default), `redis`, or the name of a store given in
	 * `MnemosyneModule.with({ cache: { stores } })`.
	 */
	store?: 'memory' | 'redis' | (string & {});

	/**
	 * Builds the cache key of a request. Defaults to the tenant, the method, the path and the query
	 * string, so that tenants never share entries.
	 */
	key?: (ctx: InterceptorContext) => string;
};

const resolveStore = (store: string): CacheInterface =>
	store === 'memory' ? Cache.memory : store === 'redis' ? Cache.redis : Cache.store(store);

const defaultKey = (ctx: InterceptorContext): string => {
	const url = new URL(ctx.request.url);
	const tenant = typeof ctx.tenant === 'string' ? ctx.tenant : 'public';
	return `http:${tenant}:${ctx.request.method}:${url.pathname}${url.search}`;
};

/**
 * Builds interceptors that cache handler results.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export abstract class CacheInterceptor {
	/**
	 * Creates an interceptor class that caches the results of `GET` and `HEAD` handlers. A cached
	 * result skips the handler. Responses (`Response` objects) are never cached. The response gets
	 * an `x-cache: hit` or `x-cache: miss` header.
	 * @param options The TTL, the cache and the key.
	 * @example
	 * ```ts
	 * @Http.get('/trending', { interceptors: [CacheInterceptor.with({ ttl: 30_000 })] })
	 * ```
	 */
	public static with(options: CacheInterceptorOptions): InterceptorClass {
		const { ttl, store = 'memory', key = defaultKey } = options;

		return class Cached implements Interceptor {
			public async intercept(ctx: InterceptorContext, next: () => Promise<unknown>) {
				const method = ctx.request.method;
				if (method !== 'GET' && method !== 'HEAD') return next();

				const cache = resolveStore(store);
				const cacheKey = key(ctx);
				const cached = await cache.get<{ value: unknown }>(cacheKey);
				if (cached !== undefined) {
					ctx.set.headers['x-cache'] = 'hit';
					return cached.value;
				}

				const value = await next();
				ctx.set.headers['x-cache'] = 'miss';
				if (!(value instanceof Response)) await cache.set(cacheKey, { value }, ttl);
				return value;
			}
		};
	}
}
