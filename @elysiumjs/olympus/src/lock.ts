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

import { Port } from './port';

/**
 * A held lock, as `acquire` answers it. Pass it back to `release` and `extend`.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type LockHandle = {
	/** The key the lock holds. */
	readonly key: string;

	/** A value unique to this holder, so that only the holder releases or extends the lock. */
	readonly token: string;
};

/**
 * Options of {@link LockDriver.acquire}.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type LockAcquireOptions = {
	/**
	 * How long to wait for the other holder to let go, in milliseconds. Defaults to 0: one try.
	 * `Infinity` waits until the lock is taken.
	 */
	wait?: number;
};

/**
 * What {@link LockDriver.run} answers: the value of the work, or that another holder had the key.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type LockRun<T> =
	{ readonly acquired: true; readonly value: T } | { readonly acquired: false };

/**
 * A lock shared by the processes that use the same driver: one holder per key at a time, until
 * it releases the lock or its time to live ends. Drivers implement `acquire`, `release` and
 * `extend`; `run` holds a lock around a piece of work.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export abstract class LockDriver {
	/**
	 * Takes the lock of a key.
	 * @param key The key, such as `invoice:42`.
	 * @param ttl How long the lock lasts, in milliseconds, unless it is released first. A driver
	 * may end it on its own terms instead: a Postgres advisory lock lasts until its transaction
	 * ends, whatever the time to live.
	 * @param options How long to wait for another holder.
	 * @returns The handle of the lock, or `null` when another holder kept it for the whole wait.
	 */
	public abstract acquire(
		key: string,
		ttl: number,
		options?: LockAcquireOptions
	): Promise<LockHandle | null>;

	/**
	 * Lets go of a lock.
	 * @param handle The handle `acquire` answered.
	 * @returns Whether the lock was still held by this handle.
	 */
	public abstract release(handle: LockHandle): Promise<boolean>;

	/**
	 * Gives a held lock a new time to live, counted from now.
	 * @param handle The handle `acquire` answered.
	 * @param ttl The new time to live, in milliseconds.
	 * @returns Whether the lock was still held by this handle.
	 */
	public abstract extend(handle: LockHandle, ttl: number): Promise<boolean>;

	/**
	 * Runs work while holding the lock of a key, and lets go of it afterwards, also when the work
	 * throws.
	 * @param key The key.
	 * @param ttl How long the lock lasts at most, in milliseconds.
	 * @param work The work.
	 * @param options How long to wait for another holder.
	 * @returns The value of the work, or `{ acquired: false }` when another holder kept the lock.
	 * @example
	 * ```ts
	 * const run = await Lock.for('memory').run('report:daily', 60_000, () => buildReport());
	 * if (!run.acquired) return; // another process builds it
	 * ```
	 */
	public async run<T>(
		key: string,
		ttl: number,
		work: () => T | Promise<T>,
		options?: LockAcquireOptions
	): Promise<LockRun<T>> {
		const handle = await this.acquire(key, ttl, options);
		if (!handle) return { acquired: false };
		try {
			return { acquired: true, value: await work() };
		} finally {
			await this.release(handle);
		}
	}
}

declare module './port' {
	interface Ports {
		lock: LockDriver;
	}

	interface PortDrivers {
		'lock:memory': typeof MemoryLock;
	}
}

/**
 * The lock port. Pick a driver with `Lock.for(name, options)`: `memory` here, and others from
 * backend packages, such as `redis` from `@elysiumjs/redis`. Each call builds a new driver; two
 * `memory` drivers hold separate locks, so share one instance between the code that must exclude
 * each other.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @example
 * ```ts
 * HeraclesModule.with({ lock: Lock.for('memory') });
 * ```
 */
export class Lock extends Port('lock') {}

type Held = { token: string; expiresAt: number };

/** The longest a timer can wait: longer delays overflow and fire at once. */
const MAX_TIMER = 2 ** 31 - 1;

/** How many takes between two sweeps of the expired locks. */
const SWEEP_EVERY = 256;

/**
 * Holds locks in the process, for tests and apps that run in one process. When a holder releases
 * a lock, the waiter that asked first takes it; a lock that expires goes to the first waiter to
 * check it again.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
@Lock.driver('memory')
export class MemoryLock extends LockDriver {
	readonly #held = new Map<string, Held>();
	readonly #waiters = new Map<string, Array<() => void>>();
	#takes = 0;

	constructor(_options?: Record<string, never>) {
		super();
	}

	public async acquire(
		key: string,
		ttl: number,
		options: LockAcquireOptions = {}
	): Promise<LockHandle | null> {
		const deadline = Date.now() + Math.max(0, options.wait ?? 0);
		for (;;) {
			const now = Date.now();
			const held = this.#held.get(key);
			if (!held || held.expiresAt <= now) {
				if (++this.#takes % SWEEP_EVERY === 0) this.#sweep(now);
				const token = crypto.randomUUID();
				this.#held.set(key, { token, expiresAt: now + ttl });
				return { key, token };
			}
			if (now >= deadline) return null;
			await this.#wait(key, Math.min(deadline, held.expiresAt) - now);
		}
	}

	public async release(handle: LockHandle): Promise<boolean> {
		const held = this.#held.get(handle.key);
		if (!held || held.token !== handle.token) return false;
		this.#held.delete(handle.key);
		this.#wake(handle.key);
		return held.expiresAt > Date.now();
	}

	public async extend(handle: LockHandle, ttl: number): Promise<boolean> {
		const held = this.#held.get(handle.key);
		if (!held || held.token !== handle.token || held.expiresAt <= Date.now()) return false;
		held.expiresAt = Date.now() + ttl;
		return true;
	}

	/** Waits until the lock of a key is released, or for at most `ms`. */
	#wait(key: string, ms: number): Promise<void> {
		return new Promise<void>((resolve) => {
			const waiters = this.#waiters.get(key) ?? [];
			this.#waiters.set(key, waiters);
			const done = () => {
				clearTimeout(timer);
				const index = waiters.indexOf(done);
				if (index !== -1) waiters.splice(index, 1);
				if (waiters.length === 0 && this.#waiters.get(key) === waiters) this.#waiters.delete(key);
				resolve();
			};
			const timer = setTimeout(done, Math.min(MAX_TIMER, Math.max(0, ms)));
			waiters.push(done);
		});
	}

	/** Forgets the locks that expired without a release, such as scheduler ticks. */
	#sweep(now: number): void {
		for (const [key, held] of this.#held) {
			if (held.expiresAt <= now) this.#held.delete(key);
		}
	}

	/** Wakes the first waiter of a key. */
	#wake(key: string): void {
		this.#waiters.get(key)?.[0]?.();
	}
}
