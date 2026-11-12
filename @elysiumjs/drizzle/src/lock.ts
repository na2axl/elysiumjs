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
import { sql } from 'drizzle-orm';

import { Database } from './database';

declare module '@elysiumjs/olympus' {
	interface PortDrivers {
		'lock:postgres': typeof PgAdvisoryLock;
	}
}

/**
 * Takes Postgres advisory locks in the current transaction: a lock lasts until the transaction
 * ends, whatever its time to live, so `release` and `extend` do nothing. Use it inside a unit of
 * work only, such as for the `serializeBy` key of an action or `Moirai.lock()`. Outside a
 * transaction, the lock ends with its own statement and excludes nobody, so it does not suit the
 * scheduler of `HeraclesModule`.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @example
 * ```ts
 * MoiraiModule.with({ lock: () => Lock.for('postgres') });
 * ```
 */
@Lock.driver('postgres')
export class PgAdvisoryLock extends LockDriver {
	constructor(
		private readonly options: {
			/** The database connection. Defaults to `default`. */
			connection?: string;
			/** How long to wait between two tries of a bounded wait, in milliseconds. Defaults to 50. */
			retryDelay?: number;
		} = {}
	) {
		super();
	}

	public async acquire(
		key: string,
		_ttl: number,
		options: LockAcquireOptions = {}
	): Promise<LockHandle | null> {
		const db = Database.getConnection(this.options.connection);
		const wait = Math.max(0, options.wait ?? 0);
		if (wait === Infinity) {
			await db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
			return { key, token: crypto.randomUUID() };
		}
		const deadline = Date.now() + wait;
		for (;;) {
			const result = await db.execute(
				sql`select pg_try_advisory_xact_lock(hashtextextended(${key}, 0)) as taken`
			);
			const rows = (Array.isArray(result) ? result : (result as { rows?: unknown[] }).rows) ?? [];
			if ((rows[0] as { taken?: boolean } | undefined)?.taken) {
				return { key, token: crypto.randomUUID() };
			}
			const left = deadline - Date.now();
			if (left <= 0) return null;
			await new Promise((resolve) =>
				setTimeout(resolve, Math.min(left, this.options.retryDelay ?? 50))
			);
		}
	}

	/** Does nothing: the lock ends with its transaction. */
	public async release(_handle: LockHandle): Promise<boolean> {
		return true;
	}

	/** Does nothing: the lock lasts until its transaction ends. */
	public async extend(_handle: LockHandle, _ttl: number): Promise<boolean> {
		return true;
	}
}
