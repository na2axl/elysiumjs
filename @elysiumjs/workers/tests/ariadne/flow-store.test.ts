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

import { describe, expect, it, mock } from 'bun:test';

let now = 1_000_000;

/** A Durable Object storage in memory, with its alarm. */
class FakeStorage {
	readonly data = new Map<string, unknown>();
	alarm: number | null = null;

	get = async <T>(key: string) => structuredClone(this.data.get(key)) as T | undefined;
	put = async (entries: Record<string, unknown>) => {
		for (const [key, value] of Object.entries(entries)) this.data.set(key, structuredClone(value));
	};
	delete = async (key: string) => this.data.delete(key);
	deleteAll = async () => this.data.clear();
	setAlarm = async (time: number) => {
		this.alarm = time;
	};
	deleteAlarm = async () => {
		this.alarm = null;
	};
}

mock.module('cloudflare:workers', () => ({
	DurableObject: class {
		constructor(
			protected ctx: unknown,
			protected env: unknown
		) {}
	}
}));

const { FlowStoreObject } = await import('../../src/durable-objects');
const { durableFlowStore } = await import('../../src');

/** A namespace binding that keeps one object per name. */
const namespace = () => {
	const objects = new Map<
		string,
		{ object: InstanceType<typeof FlowStoreObject>; storage: FakeStorage }
	>();
	const entry = (name: string) => {
		if (!objects.has(name)) {
			const storage = new FakeStorage();
			objects.set(name, { object: new FlowStoreObject({ storage } as never, {}), storage });
		}
		return objects.get(name)!;
	};
	return {
		binding: { idFromName: (name: string) => name, get: (id: string) => entry(id).object },
		entry
	};
};

const claim = (stepId: string, step: string, expectStep: string | null) => ({
	stepId,
	step,
	expectStep,
	leaseSeconds: 30
});
const commit = (stepId: string, step: string, expectStep: string | null, terminal = false) => ({
	stepId,
	step,
	expectStep,
	state: { at: step },
	answer: { done: step },
	terminal,
	ttlSeconds: 3600
});

describe('FlowStoreObject', () => {
	Date.now = () => now;

	it('claims, commits, replays and releases steps, one object per flow', async () => {
		const { binding, entry } = namespace();
		const store = durableFlowStore(() => binding);
		await store.init('f:1', 'owner', 3600);
		await store.init('f:1', 'someone-else', 3600);
		expect((await store.load('f:1'))!.owner).toBe('owner');
		expect(entry('f:1').storage.alarm).toBe(now + 3_600_000);
		expect(await store.load('f:2')).toBeNull();

		expect(await store.claim('f:1', claim('s1', 'a', null))).toEqual({ ok: true, state: null });
		expect(await store.claim('f:1', claim('s1', 'a', null))).toEqual({
			ok: false,
			reason: 'in-flight'
		});
		await store.release('f:1', 's1');
		expect(await store.claim('f:1', claim('s1', 'a', null))).toEqual({ ok: true, state: null });
		expect(await store.commit('f:1', commit('s1', 'a', null))).toEqual({
			ok: true,
			replayed: false,
			answer: { done: 'a' }
		});
		expect(await store.commit('f:1', commit('s1', 'a', null))).toMatchObject({ replayed: true });
		expect(await store.claim('f:1', claim('s1', 'a', null))).toEqual({
			ok: false,
			reason: 'replay',
			answer: { done: 'a' }
		});
		expect(await store.commit('f:1', commit('s9', 'b', 'a'))).toEqual({
			ok: false,
			reason: 'unexpected-step'
		});
	});

	it('amends under a claim, and deletes a flow that ends', async () => {
		const { binding, entry } = namespace();
		const store = durableFlowStore(binding);
		await store.init('f:1', 'owner', 60);
		await store.claim('f:1', claim('s1', 'a', null));
		await store.amend('f:1', { stepId: 'other', state: { tries: 9 }, end: false });
		await store.amend('f:1', { stepId: 's1', state: { tries: 1 }, end: false });
		expect((await store.load('f:1'))!.state).toEqual({ tries: 1 });
		await store.claim('f:1', claim('s2', 'a', null));
		await store.amend('f:1', { stepId: 's2', state: null, end: true });
		expect(await store.load('f:1')).toBeNull();
		expect(entry('f:1').storage.alarm).toBeNull();
	});

	it('keeps a finished flow as a tombstone, then a marker, then deletes it', async () => {
		const { binding, entry } = namespace();
		const store = durableFlowStore(binding);
		const { object, storage } = entry('f:1');
		await store.init('f:1', 'owner', 3600);
		await store.claim('f:1', claim('s1', 'a', null));
		await store.commit('f:1', commit('s1', 'a', null, true));
		expect(storage.alarm).toBe(now + 600_000);
		expect(await store.claim('f:1', claim('s2', 'b', 'a'))).toEqual({
			ok: false,
			reason: 'completed'
		});

		await object.alarm();
		expect(await store.load('f:1')).toMatchObject({
			owner: 'owner',
			lastAnswer: null,
			lastStepId: null
		});
		expect(storage.alarm).toBe(now + 3_600_000);

		await object.alarm();
		expect(await store.load('f:1')).toBeNull();
	});

	it('deletes an idle flow when its alarm rings', async () => {
		const { binding, entry } = namespace();
		const store = durableFlowStore(binding);
		await store.init('f:1', 'owner', 60);
		await store.claim('f:1', claim('s1', 'a', null));
		await store.commit('f:1', commit('s1', 'a', null));
		await entry('f:1').object.alarm();
		expect(await store.load('f:1')).toBeNull();
	});
});
