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

import { DurableObject } from 'cloudflare:workers';

/** The holder of a lock: its token and when it ends, in milliseconds since the epoch. */
type Holder = { token: string; expiresAt: number };

/**
 * The state of one lock, as a Durable Object: `DurableObjectLock` (`@elysiumjs/workers`) keeps
 * one object per key. An alarm deletes the holder once its time to live ends.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class LockObject extends DurableObject {
	async #holder(): Promise<Holder | null> {
		const holder = await this.ctx.storage.get<Holder>('holder');
		return holder && holder.expiresAt > Date.now() ? holder : null;
	}

	async #hold(token: string, ttl: number): Promise<void> {
		const expiresAt = Date.now() + Math.max(1, ttl);
		// The alarm first: a time it refuses leaves no holder behind.
		await this.ctx.storage.setAlarm(expiresAt);
		await this.ctx.storage.put({ holder: { token, expiresAt } satisfies Holder });
	}

	/** Takes the lock for `token`, unless another holder has it. */
	public async acquire(token: string, ttl: number): Promise<boolean> {
		if (await this.#holder()) return false;
		await this.#hold(token, ttl);
		return true;
	}

	/** Lets go of the lock, when `token` holds it. */
	public async release(token: string): Promise<boolean> {
		if ((await this.#holder())?.token !== token) return false;
		await this.ctx.storage.deleteAll();
		await this.ctx.storage.deleteAlarm();
		return true;
	}

	/** Gives the lock a new time to live, when `token` still holds it. */
	public async extend(token: string, ttl: number): Promise<boolean> {
		if ((await this.#holder())?.token !== token) return false;
		await this.#hold(token, ttl);
		return true;
	}

	public override async alarm(): Promise<void> {
		if (!(await this.#holder())) await this.ctx.storage.deleteAll();
	}
}
