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

import type { RateLimitHit, RateLimitStore } from '@elysiumjs/core';
import type { WorkersDurableObjectNamespace, WorkersDurableObjectState } from './types';

import { Workers } from './workers';

/** The storage key of the window a rate limiter object keeps. */
const WINDOW_KEY = 'window';

/**
 * The Durable Object behind {@link DurableObjectRateLimitStore}. Each rate limit key gets its own
 * object, which counts the hits of its current window and clears itself once the window ends.
 *
 * Export it from the Worker entry and bind it in the wrangler config:
 *
 * ```ts
 * export { RateLimiterObject } from '@elysiumjs/runtime-workers';
 * ```
 *
 * ```jsonc
 * {
 * 	"durable_objects": { "bindings": [{ "name": "RATE_LIMITER", "class_name": "RateLimiterObject" }] },
 * 	"migrations": [{ "tag": "v1", "new_sqlite_classes": ["RateLimiterObject"] }]
 * }
 * ```
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class RateLimiterObject {
	readonly #state: WorkersDurableObjectState;

	constructor(state: WorkersDurableObjectState, _env?: unknown) {
		this.#state = state;
	}

	/** Counts a hit. The body is `{ windowMs }`, and the answer a {@link RateLimitHit}. */
	public async fetch(request: Request): Promise<Response> {
		const { windowMs } = (await request.json()) as { windowMs: number };
		return Response.json(await this.hit(windowMs));
	}

	/**
	 * Counts a hit in the current window, or opens a new one.
	 * @param windowMs The length of the window, in milliseconds.
	 */
	public async hit(windowMs: number): Promise<RateLimitHit> {
		const storage = this.#state.storage;
		const now = Date.now();
		const current = await storage.get<RateLimitHit>(WINDOW_KEY);
		if (current && current.resetAt > now) {
			const next = { count: current.count + 1, resetAt: current.resetAt };
			await storage.put(WINDOW_KEY, next);
			return next;
		}
		const opened = { count: 1, resetAt: now + windowMs };
		await storage.put(WINDOW_KEY, opened);
		await storage.setAlarm(opened.resetAt);
		return opened;
	}

	/** Clears the object once its window has ended, so that idle keys keep no storage. */
	public async alarm(): Promise<void> {
		const current = await this.#state.storage.get<RateLimitHit>(WINDOW_KEY);
		if (current && current.resetAt > Date.now()) {
			await this.#state.storage.setAlarm(current.resetAt);
			return;
		}
		await this.#state.storage.deleteAll();
	}
}

/**
 * Options of {@link DurableObjectRateLimitStore}.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type DurableObjectRateLimitStoreOptions = {
	/** The name of the Durable Object namespace binding of {@link RateLimiterObject}. */
	binding: string;
};

/**
 * Keeps rate limit counts in Durable Objects, one {@link RateLimiterObject} per key, so that
 * every isolate of the Worker shares them. Counts are exact: an object handles its hits one at a
 * time. The namespace is read from the current invocation on every call.
 *
 * @example
 * ```ts
 * Application.register({
 * 	rateLimit: { store: new DurableObjectRateLimitStore({ binding: 'RATE_LIMITER' }) }
 * });
 * ```
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class DurableObjectRateLimitStore implements RateLimitStore {
	readonly #binding: string;

	constructor(options: DurableObjectRateLimitStoreOptions) {
		this.#binding = options.binding;
	}

	public async hit(key: string, windowMs: number): Promise<RateLimitHit> {
		const namespace = Workers.binding<WorkersDurableObjectNamespace>(this.#binding);
		const stub = namespace.get(namespace.idFromName(key));
		const response = await stub.fetch('https://rate-limiter/hit', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ windowMs })
		});
		if (!response.ok) {
			throw new Error(`The rate limiter object answered ${response.status}.`);
		}
		return (await response.json()) as RateLimitHit;
	}
}
