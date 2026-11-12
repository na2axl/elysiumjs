// Copyright (c) 2025-present Axel Nana <ax.lnana@outlook.com>. All rights reserved.
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

import type { FlowStoreNamespace } from '@elysiumjs/workers';

import { durableFlowStore } from '@elysiumjs/workers';
import { env, runDurableObjectAlarm } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

const flows = (
	env as unknown as { FLOWS: FlowStoreNamespace & { idFromName(name: string): never } }
).FLOWS;

const claim = (stepId: string, step: string, expectStep: string | null) => ({
	stepId,
	step,
	expectStep,
	leaseSeconds: 30
});

const commit = (stepId: string, step: string, expectStep: string | null, terminal: boolean) => ({
	stepId,
	step,
	expectStep,
	state: { at: step },
	answer: { done: step, items: [] },
	terminal,
	ttlSeconds: 3600
});

describe('FlowStoreObject (workerd)', () => {
	it('claims, commits and replays a step over RPC, then keeps the finished flow as a marker', async () => {
		const store = durableFlowStore(flows);
		const key = `greeting:${crypto.randomUUID()}`;
		await store.init(key, 'owner', 3600);
		expect(await store.claim(key, claim('s1', 'name', null))).toEqual({ ok: true, state: null });
		expect(await store.claim(key, claim('s1', 'name', null))).toEqual({
			ok: false,
			reason: 'in-flight'
		});
		expect(await store.commit(key, commit('s1', 'name', null, false))).toEqual({
			ok: true,
			replayed: false,
			answer: { done: 'name', items: [] }
		});
		expect(await store.claim(key, claim('s1', 'name', null))).toEqual({
			ok: false,
			reason: 'replay',
			answer: { done: 'name', items: [] }
		});

		await store.claim(key, claim('s2', 'confirm', 'name'));
		await store.commit(key, commit('s2', 'confirm', 'name', true));
		expect((await store.load(key))!.completedAt).toEqual(expect.any(String));

		const stub = flows.get(flows.idFromName(key)) as never;
		expect(await runDurableObjectAlarm(stub)).toBe(true);
		expect(await store.load(key)).toMatchObject({
			owner: 'owner',
			lastAnswer: null,
			step: 'confirm'
		});
		expect(await store.claim(key, claim('s3', 'name', 'confirm'))).toEqual({
			ok: false,
			reason: 'completed'
		});
		expect(await runDurableObjectAlarm(stub)).toBe(true);
		expect(await store.load(key)).toBeNull();
	});
});
