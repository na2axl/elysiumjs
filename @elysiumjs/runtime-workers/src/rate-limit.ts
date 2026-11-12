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

import type { RateLimitStore } from '@elysiumjs/core';
import type { WorkersRateLimitBinding } from './types';

import { Workers } from './workers';

/**
 * Options of {@link WorkersRateLimitStore}.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type WorkersRateLimitStoreOptions = {
	/** The name of the rate limiting binding, as declared in the wrangler config. */
	binding: string;
};

/**
 * Uses a Cloudflare Workers rate limiting binding (`ratelimits` in the wrangler config) as the
 * store of a limit. The binding decides whether a hit is over the limit; its limit and period are
 * set in the wrangler config, so set the same `max` and `window` on the limit, which the
 * `RateLimit-Limit`, `RateLimit-Policy` and `Retry-After` headers report. The binding gives no
 * count, so responses carry no `RateLimit-Reset`. Cloudflare counts per location, so a limit is
 * approximate. The binding is read from the current invocation on every hit.
 *
 * @example
 * ```jsonc
 * // wrangler.jsonc
 * { "ratelimits": [{ "name": "OTP_LIMITER", "namespace_id": "1001", "simple": { "limit": 3, "period": 60 } }] }
 * ```
 *
 * ```ts
 * @RateLimit({ window: 60_000, max: 3, store: new WorkersRateLimitStore({ binding: 'OTP_LIMITER' }) })
 * ```
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class WorkersRateLimitStore implements RateLimitStore {
	readonly #binding: string;

	constructor(options: WorkersRateLimitStoreOptions) {
		this.#binding = options.binding;
	}

	public async hit(key: string): Promise<{ limited: boolean }> {
		const { success } = await Workers.binding<WorkersRateLimitBinding>(this.#binding).limit({
			key
		});
		return { limited: !success };
	}
}
