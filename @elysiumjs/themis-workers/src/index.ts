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

import type { SessionData, SessionStore } from '@elysiumjs/themis';

/**
 * The part of a Workers KV namespace binding the KV session store uses.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export interface KvNamespaceLike {
	get(key: string): Promise<string | null>;
	put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
	delete(key: string): Promise<void>;
}

/**
 * Keeps sessions in a Cloudflare Workers KV namespace. KV is eventually consistent: a session saved
 * in one location can take a few seconds to be seen in another.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class KvSessionStore implements SessionStore {
	constructor(
		private readonly options: {
			/** The KV namespace, or a function that returns it (such as `() => Workers.binding('SESSIONS')`). */
			namespace: KvNamespaceLike | (() => KvNamespaceLike);
			prefix?: string;
		}
	) {}

	private get kv(): KvNamespaceLike {
		const { namespace } = this.options;
		return typeof namespace === 'function' ? namespace() : namespace;
	}

	private key(id: string): string {
		return `${this.options.prefix ?? 'session:'}${id}`;
	}

	public async load(id: string): Promise<SessionData | null> {
		const raw = await this.kv.get(this.key(id));
		return raw === null ? null : (JSON.parse(raw) as SessionData);
	}

	public async save(id: string, data: SessionData, ttlSeconds: number): Promise<void> {
		// KV refuses expirations under 60 seconds.
		await this.kv.put(this.key(id), JSON.stringify(data), {
			expirationTtl: Math.max(60, ttlSeconds)
		});
	}

	public async destroy(id: string): Promise<void> {
		await this.kv.delete(this.key(id));
	}
}
