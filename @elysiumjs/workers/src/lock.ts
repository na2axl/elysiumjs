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

import type { LockAcquireOptions, LockHandle } from '@elysiumjs/olympus';

import { Lock, LockDriver } from '@elysiumjs/olympus';

import { Workers } from './workers';

declare module '@elysiumjs/olympus' {
	interface PortDrivers {
		'lock:durable-object': typeof DurableObjectLock;
	}
}

/**
 * The RPC surface of `LockObject` (`@elysiumjs/workers/durable-objects`), as a binding's stub
 * exposes it.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type LockObjectStub = {
	acquire(token: string, ttl: number): Promise<boolean>;
	release(token: string): Promise<boolean>;
	extend(token: string, ttl: number): Promise<boolean>;
};

/**
 * The slice of a Durable Object namespace binding that {@link DurableObjectLock} uses.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type LockObjectNamespace = {
	idFromName(name: string): unknown;
	get(id: any): unknown;
};

/**
 * Options of {@link DurableObjectLock}.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type DurableObjectLockOptions = {
	/**
	 * The `LockObject` namespace binding: its name in the wrangler config, the binding itself, or a
	 * function that returns it. Defaults to `LOCKS`.
	 */
	binding?: string | LockObjectNamespace | (() => LockObjectNamespace);
	/** How long to wait between two tries of a bounded wait, in milliseconds. Defaults to 50. */
	retryDelay?: number;
};

/**
 * Holds locks in Durable Objects, one object per key, so that every isolate and every Worker that
 * shares the binding sees the same holder. A lock ends when its holder releases it or when its
 * time to live ends. Declare `LockObject` in the wrangler config and export it from the Worker's
 * entry.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @example
 * ```ts
 * // worker.ts
 * export { LockObject } from '@elysiumjs/workers/durable-objects';
 *
 * // wrangler.jsonc
 * // "durable_objects": { "bindings": [{ "name": "LOCKS", "class_name": "LockObject" }] },
 * // "migrations": [{ "tag": "v1", "new_sqlite_classes": ["LockObject"] }]
 *
 * // app.ts
 * HeraclesModule.with({ lock: Lock.for('durable-object') });
 * ```
 */
@Lock.driver('durable-object')
export class DurableObjectLock extends LockDriver {
	constructor(private readonly options: DurableObjectLockOptions = {}) {
		super();
	}

	public async acquire(
		key: string,
		ttl: number,
		options: LockAcquireOptions = {}
	): Promise<LockHandle | null> {
		const token = crypto.randomUUID();
		const stub = this.#stub(key);
		const wait = Math.max(0, options.wait ?? 0);
		const deadline = Date.now() + wait;
		for (;;) {
			if (await stub.acquire(token, ttl)) return { key, token };
			const left = deadline - Date.now();
			if (left <= 0) return null;
			await new Promise((resolve) =>
				setTimeout(resolve, Math.min(left, this.options.retryDelay ?? 50))
			);
		}
	}

	public release(handle: LockHandle): Promise<boolean> {
		return this.#stub(handle.key).release(handle.token);
	}

	public extend(handle: LockHandle, ttl: number): Promise<boolean> {
		return this.#stub(handle.key).extend(handle.token, ttl);
	}

	#stub(key: string): LockObjectStub {
		const { binding = 'LOCKS' } = this.options;
		const namespace =
			typeof binding === 'string'
				? Workers.binding<LockObjectNamespace>(binding)
				: typeof binding === 'function'
					? binding()
					: binding;
		return namespace.get(namespace.idFromName(key)) as LockObjectStub;
	}
}
