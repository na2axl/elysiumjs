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

import type { FlowStore } from '../src';

import { describe, expect, it } from 'bun:test';

import { MemoryFlowStore } from '../src';

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
	state: { at: step, list: [] },
	answer: { done: step, items: [] },
	terminal,
	ttlSeconds: 60
});

/** The rules every store follows (`@elysiumjs/ariadne-redis` runs the same ones on Redis). */
const contract = (name: string, make: () => FlowStore) => {
	describe(name, () => {
		let n = 0;
		const fresh = async () => {
			const store = make();
			const key = `test:${crypto.randomUUID()}:${n++}`;
			await store.init(key, 'owner-1', 60);
			return { store, key };
		};

		it('creates a flow once, and loads it', async () => {
			const { store, key } = await fresh();
			await store.init(key, 'someone-else', 60);
			expect(await store.load(key)).toEqual({
				owner: 'owner-1',
				step: null,
				state: null,
				lastStepId: null,
				lastAnswer: null,
				completedAt: null
			});
			expect(await store.load(`${key}:missing`)).toBeNull();
		});

		it('claims, commits and replays a step', async () => {
			const { store, key } = await fresh();
			expect(await store.claim(key, claim('s1', 'a', null))).toEqual({ ok: true, state: null });
			expect(await store.claim(key, claim('s1', 'a', null))).toEqual({
				ok: false,
				reason: 'in-flight'
			});
			// Another submission waits for the running one too.
			expect(await store.claim(key, claim('s2', 'a', null))).toEqual({
				ok: false,
				reason: 'in-flight'
			});
			expect(await store.commit(key, commit('s1', 'a', null))).toEqual({
				ok: true,
				replayed: false,
				answer: { done: 'a', items: [] }
			});
			expect(await store.commit(key, commit('s1', 'a', null))).toEqual({
				ok: true,
				replayed: true,
				answer: { done: 'a', items: [] }
			});
			expect(await store.claim(key, claim('s1', 'a', null))).toEqual({
				ok: false,
				reason: 'replay',
				answer: { done: 'a', items: [] }
			});
			expect(await store.claim(key, claim('s1', 'b', 'a'))).toEqual({
				ok: false,
				reason: 'unexpected-step'
			});
			expect(await store.load(key)).toMatchObject({
				step: 'a',
				state: { at: 'a', list: [] },
				lastStepId: 's1'
			});
		});

		it('refuses a step at the wrong position, a commit without a claim, and a missing flow', async () => {
			const { store, key } = await fresh();
			expect(await store.claim(key, claim('s1', 'b', 'a'))).toEqual({
				ok: false,
				reason: 'unexpected-step'
			});
			expect(await store.commit(key, commit('s1', 'a', null))).toEqual({
				ok: false,
				reason: 'unexpected-step'
			});
			expect(await store.claim(`${key}:x`, claim('s1', 'a', null))).toEqual({
				ok: false,
				reason: 'missing'
			});
			expect(await store.commit(`${key}:x`, commit('s1', 'a', null))).toEqual({
				ok: false,
				reason: 'missing'
			});
		});

		it('releases a claim, and amends or ends a flow under its claim only', async () => {
			const { store, key } = await fresh();
			await store.claim(key, claim('s1', 'a', null));
			await store.release(key, 'other');
			expect((await store.claim(key, claim('s1', 'a', null))).ok).toBe(false);
			await store.release(key, 's1');
			expect(await store.claim(key, claim('s1', 'a', null))).toEqual({ ok: true, state: null });

			await store.amend(key, { stepId: 'other', state: { tries: 9 }, end: false });
			expect((await store.load(key))!.state).toBeNull();
			await store.amend(key, { stepId: 's1', state: { tries: 1 }, end: false });
			expect((await store.load(key))!.state).toEqual({ tries: 1 });
			// The claim was given back, and the next one runs on the amended state.
			expect(await store.claim(key, claim('s2', 'a', null))).toEqual({
				ok: true,
				state: { tries: 1 }
			});
			await store.amend(key, { stepId: 's2', state: null, end: true });
			expect(await store.load(key)).toBeNull();
		});

		it('finishes a flow: its answer replays, and other steps are refused', async () => {
			const { store, key } = await fresh();
			await store.claim(key, claim('s1', 'a', null));
			await store.commit(key, commit('s1', 'a', null, true));
			expect((await store.load(key))!.completedAt).toEqual(expect.any(String));
			expect(await store.claim(key, claim('s1', 'a', null))).toMatchObject({ reason: 'replay' });
			expect(await store.claim(key, claim('s2', 'b', 'a'))).toEqual({
				ok: false,
				reason: 'completed'
			});
			expect(await store.commit(key, commit('s2', 'b', 'a'))).toEqual({
				ok: false,
				reason: 'completed'
			});
			await store.init(key, 'someone-else', 60);
			expect((await store.load(key))!.owner).toBe('owner-1');
		});
	});
};

contract('MemoryFlowStore', () => new MemoryFlowStore());

describe('MemoryFlowStore expiry', () => {
	it('expires an idle flow, and keeps a finished one as a marker for its TTL', async () => {
		let now = 0;
		const store = new MemoryFlowStore({ now: () => now });
		await store.init('idle', 'o', 60);
		now = 59_000;
		expect(await store.load('idle')).not.toBeNull();
		now = 60_000;
		expect(await store.load('idle')).toBeNull();

		now = 0;
		await store.init('done', 'o', 3600);
		await store.claim('done', claim('s1', 'a', null));
		await store.commit('done', { ...commit('s1', 'a', null, true), ttlSeconds: 3600 });
		now = 599_000;
		expect((await store.load('done'))!.lastAnswer).toEqual({ done: 'a', items: [] });
		now = 600_000;
		expect(await store.load('done')).toMatchObject({
			owner: 'o',
			lastAnswer: null,
			lastStepId: null
		});
		expect(await store.claim('done', claim('s1', 'a', null))).toEqual({
			ok: false,
			reason: 'completed'
		});
		now = 600_000 + 3_600_000;
		expect(await store.load('done')).toBeNull();
	});

	it('lets a lease lapse when its caller dies', async () => {
		let now = 0;
		const store = new MemoryFlowStore({ now: () => now });
		await store.init('k', 'o', 600);
		await store.claim('k', claim('s1', 'a', null));
		now = 31_000;
		expect(await store.claim('k', claim('s2', 'a', null))).toEqual({ ok: true, state: null });
	});
});
