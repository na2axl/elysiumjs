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

import type { StoredInstance, WorkflowStoreDriver } from '../../src/odysseus/index';

/** The test functions the contract runs on: those of `bun:test` or of Vitest. */
export type TestApi = {
	describe: (name: string, body: () => void) => void;
	it: (name: string, body: () => Promise<void>) => void;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	expect: (value: unknown) => any;
};

const T0 = Date.parse('2026-11-01T00:00:00Z');

/** A new instance, queued and due at `T0`. */
const queued = (workflow: string, id: string, params: unknown = { n: 1 }): StoredInstance => ({
	workflow,
	id,
	params,
	status: 'queued',
	wakeAt: T0,
	createdAt: T0,
	updatedAt: T0
});

/**
 * What every workflow store does, run on the stores of olympus, `@elysiumjs/drizzle` and
 * `@elysiumjs/redis`. `make` gives an empty store.
 */
export const workflowStoreContract = (
	{ describe, it, expect }: TestApi,
	name: string,
	make: () => WorkflowStoreDriver | Promise<WorkflowStoreDriver>
): void => {
	describe(`${name} workflow store`, () => {
		it('creates an instance once and reads it back as JSON', async () => {
			const store = await make();
			const params = { order: { id: '42', lines: [1, 2] }, note: null };
			expect(await store.create(queued('orders', 'a', params))).toBe(true);
			expect(await store.create(queued('orders', 'a', { other: true }))).toBe(false);
			expect(await store.get('orders', 'a')).toMatchObject({
				workflow: 'orders',
				id: 'a',
				params,
				status: 'queued',
				wakeAt: T0,
				createdAt: T0,
				updatedAt: T0
			});
			expect(await store.get('orders', 'missing')).toBeNull();
			expect(await store.get('other', 'a')).toBeNull();
		});

		it('answers the due instances of the given workflows, oldest wake first', async () => {
			const store = await make();
			await store.create({ ...queued('orders', 'late'), wakeAt: T0 + 2000 });
			await store.create({ ...queued('orders', 'early'), wakeAt: T0 - 1000 });
			await store.create(queued('orders', 'now'));
			await store.create(queued('billing', 'b'));
			await store.create({ ...queued('orders', 'never'), wakeAt: null });
			expect(await store.due(T0, 10, ['orders'])).toEqual([
				{ workflow: 'orders', id: 'early' },
				{ workflow: 'orders', id: 'now' }
			]);
			expect(await store.due(T0, 1, ['orders'])).toEqual([{ workflow: 'orders', id: 'early' }]);
			expect(await store.due(T0, 10, [])).toEqual([]);
			expect((await store.due(T0 + 5000, 10, ['orders', 'billing'])).length).toBe(4);
		});

		it('lets one lease hold an instance until it ends', async () => {
			const store = await make();
			await store.create(queued('orders', 'a'));
			const claimed = await store.claim('orders', 'a', { owner: 'w1', until: T0 + 1000 }, T0);
			expect(claimed).toMatchObject({
				instance: { status: 'running' },
				steps: {},
				events: [],
				lastSeq: 0
			});
			expect(await store.claim('orders', 'a', { owner: 'w2', until: T0 + 1000 }, T0)).toBeNull();
			expect(await store.due(T0, 10, ['orders'])).toEqual([]);
			expect(await store.extend('orders', 'a', { owner: 'w2', until: T0 + 5000 })).toBe(false);
			expect(await store.extend('orders', 'a', { owner: 'w1', until: T0 + 2000 })).toBe(true);
			expect(
				await store.claim('orders', 'a', { owner: 'w2', until: T0 + 3000 }, T0 + 1500)
			).toBeNull();
			expect(await store.due(T0 + 2000, 10, ['orders'])).toEqual([{ workflow: 'orders', id: 'a' }]);
			expect(
				await store.claim('orders', 'a', { owner: 'w2', until: T0 + 5000 }, T0 + 2000)
			).not.toBeNull();
			expect(await store.saveStep('orders', 'a', 'w1', 's', { kind: 'done', value: 1 })).toBe(
				false
			);
			expect(await store.extend('orders', 'a', { owner: 'w1', until: T0 + 9000 })).toBe(false);
			expect(await store.claim('orders', 'missing', { owner: 'w', until: T0 + 1 }, T0)).toBeNull();
		});

		it('keeps steps and events, and hands them to the next claim', async () => {
			const store = await make();
			await store.create(queued('orders', 'a'));
			await store.claim('orders', 'a', { owner: 'w1', until: T0 + 1000 }, T0);
			expect(await store.addEvent('orders', 'a', 'paid', { amount: 5 }, T0 + 1)).toBe('sent');
			expect(await store.addEvent('orders', 'a', 'paid', { amount: 7 }, T0 + 2)).toBe('sent');
			expect(
				await store.saveStep('orders', 'a', 'w1', 'reserve', {
					kind: 'done',
					value: { id: 'r1' }
				})
			).toBe(true);
			expect(
				await store.saveStep('orders', 'a', 'w1', 'wait', { kind: 'done', value: { amount: 5 } }, 1)
			).toBe(true);
			expect(
				await store.saveStep('orders', 'a', 'w1', 'call', {
					kind: 'retry',
					attempts: 1,
					at: T0 + 60
				})
			).toBe(true);
			expect(
				await store.saveStep('orders', 'a', 'w1', 'call', {
					kind: 'failed',
					attempts: 2,
					reason: 'boom'
				})
			).toBe(true);
			expect(
				await store.settle(
					'orders',
					'a',
					'w1',
					{ status: 'waiting', wakeAt: T0 + 100, seenSeq: 2 },
					T0 + 3
				)
			).toBe(true);
			expect(await store.get('orders', 'a')).toMatchObject({ status: 'waiting', wakeAt: T0 + 100 });

			const next = await store.claim('orders', 'a', { owner: 'w2', until: T0 + 2000 }, T0 + 100);
			expect(next?.steps).toEqual({
				reserve: { kind: 'done', value: { id: 'r1' } },
				wait: { kind: 'done', value: { amount: 5 } },
				call: { kind: 'failed', attempts: 2, reason: 'boom' }
			});
			expect(next?.events).toEqual([{ seq: 2, type: 'paid', payload: { amount: 7 }, at: T0 + 2 }]);
			expect(next?.lastSeq).toBe(2);
		});

		it('wakes an instance at once for an event that came while it ran', async () => {
			const store = await make();
			await store.create(queued('orders', 'a'));
			await store.claim('orders', 'a', { owner: 'w1', until: T0 + 1000 }, T0);
			await store.addEvent('orders', 'a', 'paid', {}, T0 + 1);
			await store.settle(
				'orders',
				'a',
				'w1',
				{ status: 'waiting', wakeAt: T0 + 86_400_000, seenSeq: 0 },
				T0 + 2
			);
			expect(await store.get('orders', 'a')).toMatchObject({ status: 'waiting', wakeAt: T0 + 2 });
			expect(await store.due(T0 + 2, 10, ['orders'])).toEqual([{ workflow: 'orders', id: 'a' }]);
		});

		it('makes a sleeping instance due when an event comes', async () => {
			const store = await make();
			await store.create(queued('orders', 'a'));
			await store.claim('orders', 'a', { owner: 'w1', until: T0 + 1000 }, T0);
			await store.settle('orders', 'a', 'w1', { status: 'waiting', wakeAt: null, seenSeq: 0 }, T0);
			expect(await store.due(T0 + 10, 10, ['orders'])).toEqual([]);
			await store.addEvent('orders', 'a', 'paid', null, T0 + 10);
			expect(await store.get('orders', 'a')).toMatchObject({ wakeAt: T0 + 10 });
			expect(await store.due(T0 + 10, 10, ['orders'])).toEqual([{ workflow: 'orders', id: 'a' }]);
		});

		it('ends instances, refuses events to finished ones, and stops them once', async () => {
			const store = await make();
			await store.create(queued('orders', 'done'));
			await store.claim('orders', 'done', { owner: 'w1', until: T0 + 1000 }, T0);
			const output = { '~problem': { code: 'OUT_OF_STOCK', status: 409, name: 'OutOfStock' } };
			expect(
				await store.settle(
					'orders',
					'done',
					'w2',
					{ status: 'completed', wakeAt: null, output, seenSeq: 0 },
					T0 + 5
				)
			).toBe(false);
			expect(
				await store.settle(
					'orders',
					'done',
					'w1',
					{ status: 'completed', wakeAt: null, output, seenSeq: 0 },
					T0 + 5
				)
			).toBe(true);
			expect(await store.get('orders', 'done')).toMatchObject({
				status: 'completed',
				output,
				wakeAt: null,
				updatedAt: T0 + 5
			});
			expect(await store.addEvent('orders', 'done', 'paid', {}, T0 + 6)).toBe('finished');
			expect(await store.addEvent('orders', 'missing', 'paid', {}, T0 + 6)).toBe('missing');
			expect(await store.terminate('orders', 'done', T0 + 6)).toBe(false);

			await store.create(queued('orders', 'failed'));
			await store.claim('orders', 'failed', { owner: 'w1', until: T0 + 1000 }, T0);
			const error = { name: 'Error', message: 'boom' };
			await store.settle(
				'orders',
				'failed',
				'w1',
				{ status: 'errored', wakeAt: null, error, seenSeq: 0 },
				T0 + 5
			);
			expect(await store.get('orders', 'failed')).toMatchObject({ status: 'errored', error });

			await store.create(queued('orders', 'held'));
			await store.claim('orders', 'held', { owner: 'w1', until: T0 + 1000 }, T0);
			expect(await store.terminate('orders', 'held', T0 + 7)).toBe(true);
			expect(await store.get('orders', 'held')).toMatchObject({
				status: 'terminated',
				wakeAt: null
			});
			expect(await store.saveStep('orders', 'held', 'w1', 's', { kind: 'done', value: 1 })).toBe(
				false
			);
			expect(await store.terminate('orders', 'held', T0 + 8)).toBe(false);
			expect(await store.terminate('orders', 'missing', T0 + 8)).toBe(false);
			expect(await store.due(T0 + 5000, 10, ['orders'])).toEqual([]);
		});

		it('purges the instances that finished before a time', async () => {
			const store = await make();
			for (const id of ['old', 'recent', 'live']) {
				await store.create(queued('orders', id));
				await store.claim('orders', id, { owner: 'w', until: T0 + 1000 }, T0);
				await store.saveStep('orders', id, 'w', 's', { kind: 'done', value: id });
			}
			await store.addEvent('orders', 'old', 'paid', {}, T0);
			await store.settle(
				'orders',
				'old',
				'w',
				{ status: 'completed', wakeAt: null, seenSeq: 1 },
				T0 + 10
			);
			await store.settle(
				'orders',
				'recent',
				'w',
				{ status: 'completed', wakeAt: null, seenSeq: 0 },
				T0 + 100
			);
			expect(await store.purge(T0 + 50)).toBe(1);
			expect(await store.get('orders', 'old')).toBeNull();
			expect(await store.get('orders', 'recent')).not.toBeNull();
			expect(await store.get('orders', 'live')).not.toBeNull();
			// A new instance with the id of a purged one starts with no steps or events.
			await store.create(queued('orders', 'old'));
			const again = await store.claim('orders', 'old', { owner: 'w2', until: T0 + 1000 }, T0);
			expect(again).toMatchObject({ steps: {}, events: [], lastSeq: 0 });
		});
	});
};
