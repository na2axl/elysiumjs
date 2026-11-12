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

import type {
	FlowAmend,
	FlowClaim,
	FlowClaimResult,
	FlowCommit,
	FlowCommitResult,
	FlowRecord,
	FlowSlot,
	FlowStore
} from '@elysiumjs/olympus/ariadne';

import { FLOW_TOMBSTONE_SECONDS, FlowRules } from '@elysiumjs/olympus/ariadne';
import { DurableObject } from 'cloudflare:workers';

/** `active`: a running flow. `tombstone`: its last answer replays. `marker`: owner and end time only. */
type Phase = 'active' | 'tombstone' | 'marker';

/**
 * The state of one flow, named `{flow}:{flowKey}`, as a Durable Object with an RPC surface.
 * Declare it in `wrangler.jsonc`, export it from the Worker's entry, and give its binding to
 * {@link durableFlowStore}.
 *
 * Each commit pushes the expiry alarm to its TTL. A finished flow keeps its answer for up to 10
 * minutes, then only its owner and end time for its TTL, then deletes itself.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @example
 * ```ts
 * // worker.ts
 * export { FlowStoreObject } from '@elysiumjs/ariadne-workers';
 *
 * // wrangler.jsonc
 * // "durable_objects": { "bindings": [{ "name": "FLOWS", "class_name": "FlowStoreObject" }] },
 * // "migrations": [{ "tag": "v1", "new_sqlite_classes": ["FlowStoreObject"] }]
 * ```
 */
export class FlowStoreObject extends DurableObject {
	private async slot(): Promise<FlowSlot> {
		const [record, lease] = await Promise.all([
			this.ctx.storage.get<FlowRecord>('record'),
			this.ctx.storage.get<FlowSlot['lease']>('lease')
		]);
		return { record: record ?? null, lease: lease ?? null };
	}

	private async keep(slot: FlowSlot): Promise<void> {
		if (slot.record === null) {
			await this.ctx.storage.deleteAll();
			await this.ctx.storage.deleteAlarm();
			return;
		}
		await this.ctx.storage.put({ record: slot.record, lease: slot.lease });
	}

	private async arm(seconds: number): Promise<void> {
		await this.ctx.storage.setAlarm(Date.now() + seconds * 1000);
	}

	/** Creates the flow. An existing one, running or finished, is left as it is. */
	public async init(owner: string, ttlSeconds: number): Promise<void> {
		if ((await this.ctx.storage.get('record')) !== undefined) return;
		await this.ctx.storage.put({
			record: FlowRules.created(owner),
			lease: null,
			phase: 'active' satisfies Phase,
			ttl: ttlSeconds
		});
		await this.arm(ttlSeconds);
	}

	public async load(): Promise<FlowRecord | null> {
		return (await this.ctx.storage.get<FlowRecord>('record')) ?? null;
	}

	public async claim(input: FlowClaim): Promise<FlowClaimResult> {
		const { result, slot } = FlowRules.claim(await this.slot(), input, Date.now());
		if (result.ok) await this.keep(slot);
		return result;
	}

	public async release(stepId: string): Promise<void> {
		const before = await this.slot();
		const after = FlowRules.release(before, stepId, Date.now());
		if (after !== before) await this.keep(after);
	}

	public async commit(input: FlowCommit): Promise<FlowCommitResult> {
		const { result, slot } = FlowRules.commit(await this.slot(), input, Date.now());
		if (!result.ok || result.replayed) return result;
		await this.keep(slot);
		if (input.terminal) {
			await this.ctx.storage.put({ phase: 'tombstone' satisfies Phase, ttl: input.ttlSeconds });
			await this.arm(Math.min(FLOW_TOMBSTONE_SECONDS, input.ttlSeconds));
		} else {
			await this.ctx.storage.put({ ttl: input.ttlSeconds });
			await this.arm(input.ttlSeconds);
		}
		return result;
	}

	public async amend(input: FlowAmend): Promise<void> {
		const before = await this.slot();
		const after = FlowRules.amend(before, input, Date.now());
		if (after !== before) await this.keep(after);
	}

	/** Turns a finished flow's tombstone into its marker, or deletes an expired flow. */
	public override async alarm(): Promise<void> {
		const record = await this.load();
		if (record !== null && (await this.ctx.storage.get<Phase>('phase')) === 'tombstone') {
			await this.ctx.storage.put({
				record: FlowRules.marker(record),
				phase: 'marker' satisfies Phase
			});
			await this.arm((await this.ctx.storage.get<number>('ttl')) ?? FLOW_TOMBSTONE_SECONDS);
			return;
		}
		await this.ctx.storage.deleteAll();
	}
}

/**
 * The RPC surface of {@link FlowStoreObject}, as a binding's stub exposes it.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type FlowStoreStub = {
	init(owner: string, ttlSeconds: number): Promise<void>;
	load(): Promise<FlowRecord | null>;
	claim(input: FlowClaim): Promise<FlowClaimResult>;
	release(stepId: string): Promise<void>;
	commit(input: FlowCommit): Promise<FlowCommitResult>;
	amend(input: FlowAmend): Promise<void>;
};

/**
 * The slice of a Durable Object namespace binding that {@link durableFlowStore} uses.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type FlowStoreNamespace = {
	idFromName(name: string): unknown;
	get(id: any): unknown;
};

/**
 * A flow store over the {@link FlowStoreObject} binding: one object per flow.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @param binding The binding, or a function that returns it, such as
 * `() => Workers.env().FLOWS`.
 * @example
 * ```ts
 * AriadneModule.with({ flows, store: durableFlowStore(() => Workers.env().FLOWS) });
 * ```
 */
export const durableFlowStore = (
	binding: FlowStoreNamespace | (() => FlowStoreNamespace)
): FlowStore => {
	const stub = (key: string): FlowStoreStub => {
		const namespace = typeof binding === 'function' ? binding() : binding;
		return namespace.get(namespace.idFromName(key)) as FlowStoreStub;
	};
	return {
		init: (key, owner, ttlSeconds) => stub(key).init(owner, ttlSeconds),
		load: (key) => stub(key).load(),
		claim: (key, input) => stub(key).claim(input),
		release: (key, stepId) => stub(key).release(stepId),
		commit: (key, input) => stub(key).commit(input),
		amend: (key, input) => stub(key).amend(input)
	};
};
