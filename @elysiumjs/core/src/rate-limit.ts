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

import { t } from 'elysia';

import { Metadata } from './metadata';
import { DomainError } from './problem';

/**
 * What a store answers for a hit: the count of the key in its current window, or, for stores that
 * only decide (such as the Cloudflare rate limiting binding), whether the hit is over the limit.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type RateLimitHit =
	| {
			/** The number of hits in the window, this one included. */
			count: number;
			/** When the window ends, in milliseconds since the epoch. */
			resetAt: number;
	  }
	| {
			/** Whether the hit is over the limit. */
			limited: boolean;
	  };

/**
 * Where rate limits keep their counts. Counts use fixed windows: the first hit of a key opens a
 * window of `windowMs`, and the count starts again once it has ended. Implement it to keep the
 * counts anywhere; `MemoryRateLimitStore` keeps them in the process, `RedisRateLimitStore`
 * (`@elysiumjs/redis`) in Redis, and `WorkersRateLimitStore` (`@elysiumjs/runtime-workers`) uses
 * a Cloudflare rate limiting binding.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export interface RateLimitStore {
	/**
	 * Counts a hit of a key.
	 * @param key The key, such as the client address and the route.
	 * @param windowMs The length of the window, in milliseconds.
	 */
	hit(key: string, windowMs: number): Promise<RateLimitHit>;
}

/**
 * Keeps rate limit counts in the memory of the process. Counts are not shared between
 * processes or Worker isolates: use another store when the app runs on several.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class MemoryRateLimitStore implements RateLimitStore {
	readonly #windows = new Map<string, { count: number; resetAt: number }>();
	#nextSweep = 0;

	public async hit(key: string, windowMs: number): Promise<{ count: number; resetAt: number }> {
		const now = Date.now();
		this.#sweep(now);
		const current = this.#windows.get(key);
		if (current && current.resetAt > now) {
			current.count++;
			return { ...current };
		}
		const opened = { count: 1, resetAt: now + windowMs };
		this.#windows.set(key, opened);
		return { ...opened };
	}

	/** Drops ended windows, at most once a second, so that idle keys do not pile up. */
	#sweep(now: number): void {
		if (now < this.#nextSweep) return;
		this.#nextSweep = now + 1000;
		for (const [key, window] of this.#windows) {
			if (window.resetAt <= now) this.#windows.delete(key);
		}
	}
}

/**
 * What a rate limit key is built from.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type RateLimitKeyContext = {
	request: Request;
	/** The client address (`ctx.ip`), when the runtime knows it. */
	ip?: string;
	/** The route, such as `GET /posts/:id`. */
	route: string;
	/** The whole request context, for keys built from the current user or tenant. */
	context: Record<string, unknown>;
};

/**
 * A rate limit of a route, a controller or the app.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type RateLimitOptions = {
	/** The length of a window, in milliseconds. */
	window: number;
	/** The hits a key may make in a window. */
	max: number;
	/**
	 * Builds the key the limit counts. Defaults to the client address and the route, so that each
	 * client has its own count on each route.
	 */
	key?: (context: RateLimitKeyContext) => string | Promise<string>;
	/** Where the counts are kept. Defaults to the app's store, or one in memory. */
	store?: RateLimitStore;
	/** A name for the limit, in the `RateLimit-Policy` header and the keys. */
	name?: string;
};

/**
 * The rate limit options of an application: the store of every limit, and a limit for every
 * route that sets none.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type AppRateLimitOptions = Partial<RateLimitOptions>;

/**
 * Raised when a client goes over a rate limit. Rendered as a 429 problem, with `Retry-After`.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class TooManyRequestsError extends DomainError.for('RATE_LIMITED', 429, {
	extensions: { retryAfter: t.Integer({ description: 'Seconds until the client may retry.' }) }
}) {
	constructor(public readonly retryAfter: number) {
		super(`Too many requests. Try again in ${retryAfter} seconds.`, {
			retryAfterSeconds: retryAfter
		});
	}
}

const RATE_LIMIT = Symbol.for('elysium:RateLimit');

/**
 * Sets the rate limit of a route, or of every route of a controller. A limit on a route wins over
 * the one of its controller, which wins over the app's default (`rateLimit` of
 * `@Application.register()`). Pass `false` to turn the limit off. Each route counts on its own.
 *
 * The limit is counted in the route's `beforeHandle`, after the body is parsed and validated and
 * after the `onBeforeHandle` middlewares of the application ran. A middleware that is costly for a
 * client over the limit (a database lookup, say) runs on the routes that need it, not on the
 * application.
 * @author Axel Nana <axel.nana@workbud.com>
 * @param limit The limit, or `false` for none.
 * @example
 * ```ts
 * @Http.controller('/auth')
 * @RateLimit({ window: 60_000, max: 10 })
 * class AuthController {
 * 	@Http.post('/otp')
 * 	@RateLimit({ window: 60_000, max: 3, name: 'otp' })
 * 	public sendOtp() {}
 * }
 * ```
 */
export const RateLimit =
	(limit: RateLimitOptions | false) =>
	(target: object, propertyKey?: string | symbol, _descriptor?: PropertyDescriptor): void => {
		Metadata.define(RATE_LIMIT, limit, target, propertyKey);
	};

/**
 * The limit `@RateLimit()` sets on a route, else on its controller.
 * @author Axel Nana <axel.nana@workbud.com>
 * @param controller The controller class.
 * @param method The name of the route method.
 */
export const rateLimitOf = (
	controller: Function,
	method: string | symbol
): RateLimitOptions | false | undefined =>
	Metadata.get(RATE_LIMIT, controller.prototype, method) ?? Metadata.get(RATE_LIMIT, controller);

/** The store used when neither the limit nor the app sets one. */
const defaultStore = new MemoryRateLimitStore();

/**
 * Counts a hit against a limit, sets the `RateLimit-*` headers, and throws once the limit is
 * exceeded.
 * @author Axel Nana <axel.nana@workbud.com>
 * @param limit The limit.
 * @param appStore The store of the application, used when the limit sets none.
 * @param context The request: its context, client address and route.
 * @throws {TooManyRequestsError} When the key went over the limit in the current window.
 */
export const enforceRateLimit = async (
	limit: RateLimitOptions,
	appStore: RateLimitStore | undefined,
	context: RateLimitKeyContext & { set: { headers: Record<string, string | number> } }
): Promise<void> => {
	const name = limit.name ?? 'default';
	const key = limit.key ? await limit.key(context) : `${context.ip ?? 'unknown'}:${context.route}`;
	const store = limit.store ?? appStore ?? defaultStore;
	const hit = await store.hit(`rl:${name}:${key}`, limit.window);

	const headers = context.set.headers;
	headers['ratelimit-limit'] = String(limit.max);
	headers['ratelimit-policy'] = `${limit.max};w=${Math.ceil(limit.window / 1000)}`;

	if ('limited' in hit) {
		// The store only decides: the window may have started at any time, so a client waits for a
		// whole one at most.
		if (!hit.limited) return;
		const retryAfter = Math.ceil(limit.window / 1000);
		headers['ratelimit-remaining'] = '0';
		headers['retry-after'] = String(retryAfter);
		throw new TooManyRequestsError(retryAfter);
	}

	const reset = Math.max(0, Math.ceil((hit.resetAt - Date.now()) / 1000));
	headers['ratelimit-remaining'] = String(Math.max(0, limit.max - hit.count));
	headers['ratelimit-reset'] = String(reset);

	if (hit.count > limit.max) {
		headers['retry-after'] = String(reset);
		throw new TooManyRequestsError(reset);
	}
};
