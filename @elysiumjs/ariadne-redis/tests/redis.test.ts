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

import type { FlowStore } from '@elysiumjs/ariadne';

import { bunRedis } from '@elysiumjs/redis';
import { afterAll, describe, expect, it } from 'bun:test';

import { RedisFlowStore } from '../src';

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

/** The rules every store follows (the same as the stores of `@elysiumjs/ariadne`). */
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
			expect(await store.claim(key, claim('s1', 'a', null))).toEqual({ ok: true });
			expect(await store.claim(key, claim('s1', 'a', null))).toEqual({
				ok: false,
				reason: 'in-flight'
			});
			expect(await store.claim(key, claim('s2', 'a', null))).toEqual({
				ok: false,
				reason: 'unexpected-step'
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
			expect(await store.claim(key, claim('s1', 'a', null))).toEqual({ ok: true });

			await store.amend(key, { stepId: 'other', state: { tries: 9 }, end: false });
			expect((await store.load(key))!.state).toBeNull();
			await store.amend(key, { stepId: 's1', state: { tries: 1 }, end: false });
			expect((await store.load(key))!.state).toEqual({ tries: 1 });
			// The claim was given back.
			expect(await store.claim(key, claim('s2', 'a', null))).toEqual({ ok: true });
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

// Runs against the server of REDIS_URL, and is skipped without one.
const url = process.env.REDIS_URL;
if (url) {
	const connection = bunRedis(url, {});
	afterAll(() => connection.close());
	contract('RedisFlowStore', () => new RedisFlowStore({ connection, prefix: 'ariadne-test:' }));

	it('RedisFlowStore keeps only the owner and end time once the answer expired', async () => {
		const store = new RedisFlowStore({ connection: () => connection });
		const key = `test:${crypto.randomUUID()}`;
		await store.init(key, 'owner-1', 60);
		await store.claim(key, claim('s1', 'a', null));
		await store.commit(key, commit('s1', 'a', null, true));
		expect(Number(await connection.send('TTL', [`flow:{${key}}`]))).toBeLessThanOrEqual(60);
		expect(Number(await connection.send('TTL', [`flow:{${key}}:done`]))).toBeGreaterThan(60);
		await connection.del(`flow:{${key}}`);
		expect(await store.load(key)).toEqual({
			owner: 'owner-1',
			step: null,
			state: null,
			lastStepId: null,
			lastAnswer: null,
			completedAt: expect.any(String)
		});
		expect(await store.claim(key, claim('s1', 'a', null))).toEqual({
			ok: false,
			reason: 'completed'
		});
		expect(await store.commit(key, commit('s1', 'a', null))).toEqual({
			ok: false,
			reason: 'completed'
		});
	});
}

describe('RedisFlowStore', () => {
	it('keeps the keys of a flow on one cluster slot, under its prefix', async () => {
		const sent: string[][] = [];
		const connection = {
			send: async (command: string, args: string[]) => {
				sent.push([command, ...args]);
				return command === 'HMGET' ? [null, null] : ['ok'];
			}
		} as never;
		const store = new RedisFlowStore({ connection, prefix: 'app:flow:' });
		expect(await store.claim('sign-up:k1', claim('s1', 'email', null))).toEqual({ ok: true });
		expect(sent[0]!.slice(0, 1)).toEqual(['EVAL']);
		expect(sent[0]!.slice(2, 6)).toEqual([
			'3',
			'app:flow:{sign-up:k1}',
			'app:flow:{sign-up:k1}:lease',
			'app:flow:{sign-up:k1}:done'
		]);
		expect(sent[0]!.slice(6)).toEqual(['s1', 'email', '', '30000']);
		expect(await store.load('sign-up:k1')).toBeNull();
	});
});
