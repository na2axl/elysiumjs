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

import type { FlowSlot } from '../rules';
import type {
	FlowAmend,
	FlowClaim,
	FlowClaimResult,
	FlowCommit,
	FlowCommitResult,
	FlowRecord,
	FlowStore
} from '../store';

import { FlowRules } from '../rules';
import { FLOW_TOMBSTONE_SECONDS } from '../store';

type Entry = FlowSlot & {
	/** When the entry expires, in milliseconds. */
	expiresAt: number;
	phase: 'active' | 'tombstone' | 'marker';
	/** The flow's TTL, for the marker that follows the tombstone. */
	ttlSeconds: number;
};

/**
 * Keeps flows in memory, for tests and single-process apps.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class MemoryFlowStore implements FlowStore {
	readonly #entries = new Map<string, Entry>();

	/** @param options `now` is the clock, in milliseconds (`Date.now` by default). */
	constructor(private readonly options: { now?: () => number } = {}) {}

	private now(): number {
		return this.options.now?.() ?? Date.now();
	}

	/** The entry of a flow, once its expiry has been applied. */
	private entry(key: string): Entry | undefined {
		const entry = this.#entries.get(key);
		if (!entry) return undefined;
		const now = this.now();
		if (entry.expiresAt > now) return entry;
		if (entry.phase === 'tombstone' && entry.record) {
			const marker: Entry = {
				...entry,
				record: FlowRules.marker(entry.record),
				phase: 'marker',
				expiresAt: entry.expiresAt + entry.ttlSeconds * 1000
			};
			this.#entries.set(key, marker);
			return this.entry(key);
		}
		this.#entries.delete(key);
		return undefined;
	}

	private slot(key: string): FlowSlot {
		const entry = this.entry(key);
		return { record: entry?.record ?? null, lease: entry?.lease ?? null };
	}

	private keep(key: string, slot: FlowSlot, ttlSeconds?: number): void {
		const entry = this.#entries.get(key);
		if (slot.record === null || !entry) {
			this.#entries.delete(key);
			return;
		}
		const finished = slot.record.completedAt !== null && entry.phase === 'active';
		const ttl = ttlSeconds ?? entry.ttlSeconds;
		this.#entries.set(key, {
			...slot,
			ttlSeconds: ttl,
			phase: finished ? 'tombstone' : entry.phase,
			expiresAt:
				ttlSeconds === undefined
					? entry.expiresAt
					: this.now() + (finished ? Math.min(FLOW_TOMBSTONE_SECONDS, ttl) : ttl) * 1000
		});
	}

	public init(key: string, owner: string, ttlSeconds: number): Promise<void> {
		if (!this.entry(key)) {
			this.#entries.set(key, {
				record: FlowRules.created(owner),
				lease: null,
				phase: 'active',
				ttlSeconds,
				expiresAt: this.now() + ttlSeconds * 1000
			});
		}
		return Promise.resolve();
	}

	public load(key: string): Promise<FlowRecord | null> {
		return Promise.resolve(this.entry(key)?.record ?? null);
	}

	public claim(key: string, input: FlowClaim): Promise<FlowClaimResult> {
		const { result, slot } = FlowRules.claim(this.slot(key), input, this.now());
		this.keep(key, slot);
		return Promise.resolve(result);
	}

	public release(key: string, stepId: string): Promise<void> {
		this.keep(key, FlowRules.release(this.slot(key), stepId, this.now()));
		return Promise.resolve();
	}

	public commit(key: string, input: FlowCommit): Promise<FlowCommitResult> {
		const { result, slot } = FlowRules.commit(this.slot(key), input, this.now());
		if (result.ok && !result.replayed) this.keep(key, slot, input.ttlSeconds);
		return Promise.resolve(result);
	}

	public amend(key: string, input: FlowAmend): Promise<void> {
		this.keep(key, FlowRules.amend(this.slot(key), input, this.now()));
		return Promise.resolve();
	}
}
