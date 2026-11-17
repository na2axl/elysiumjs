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

// Runs against the server of REDIS_URL, and is skipped without one.

import type { RedisConnection } from '../../src/connection';

import { WorkflowStore } from '@elysiumjs/olympus/odysseus';
import { afterAll, beforeAll, describe, expect, it, spyOn } from 'bun:test';

import { workflowStoreContract } from '../../../olympus/tests/odysseus/store-contract';
import { RedisWorkflowStore } from '../../src';
import { Redis } from '../../src/redis';

const url = process.env.REDIS_URL;

describe('RedisWorkflowStore', () => {
	it('registers the redis driver of the workflow store', () => {
		expect(WorkflowStore.has('redis')).toBe(true);
		expect(WorkflowStore.for('redis', { prefix: 'x:' })).toBeInstanceOf(RedisWorkflowStore);
	});
});

describe.skipIf(!url)('RedisWorkflowStore on a Redis server', () => {
	let client: Bun.RedisClient;
	let getConnection: { mockRestore: () => void };

	beforeAll(() => {
		client = new Bun.RedisClient(url!);
		getConnection = spyOn(Redis, 'getConnection').mockReturnValue(
			client as unknown as RedisConnection
		);
	});

	afterAll(async () => {
		const keys = (await client.send('KEYS', ['test:odysseus:*'])) as string[];
		if (keys.length > 0) await client.send('DEL', keys);
		getConnection.mockRestore();
		client.close();
	});

	workflowStoreContract(
		{ describe, it, expect },
		'redis',
		() => new RedisWorkflowStore({ prefix: `test:odysseus:${crypto.randomUUID()}:` })
	);

	it('lets one of many claims of an instance win', async () => {
		const store = new RedisWorkflowStore({ prefix: `test:odysseus:${crypto.randomUUID()}:` });
		const now = Date.parse('2026-11-01T00:00:00Z');
		await store.create({
			workflow: 'race',
			id: 'a',
			params: { big: 1793491200000, pi: 3.141592653589793 },
			status: 'queued',
			wakeAt: now,
			createdAt: now,
			updatedAt: now
		});
		const claims = await Promise.all(
			Array.from({ length: 8 }, (_, i) =>
				store.claim('race', 'a', { owner: `w${i}`, until: now + 1000 }, now)
			)
		);
		const won = claims.filter(Boolean);
		expect(won.length).toBe(1);
		expect(won[0]!.instance.params).toEqual({ big: 1793491200000, pi: 3.141592653589793 });
	});

	const now = Date.parse('2026-11-01T00:00:00Z');
	const finish = async (store: RedisWorkflowStore, id: string, at: number) => {
		await store.create({
			workflow: 'w',
			id,
			params: null,
			status: 'queued',
			wakeAt: now,
			createdAt: now,
			updatedAt: now
		});
		await store.claim('w', id, { owner: 'o', until: now + 1000 }, now);
		await store.settle('w', id, 'o', { status: 'completed', wakeAt: null, seenSeq: 0 }, at);
	};

	it('purges in batches until none is left', async () => {
		const store = new RedisWorkflowStore({
			prefix: `test:odysseus:${crypto.randomUUID()}:`,
			purgeBatch: 2
		});
		for (const id of ['a', 'b', 'c', 'd', 'e']) await finish(store, id, now + 1);
		await finish(store, 'late', now + 100);
		expect(await store.purge(now + 50)).toBe(5);
		expect(await store.get('w', 'late')).not.toBeNull();
	});

	it('drops a due entry whose instance is gone', async () => {
		const prefix = `test:odysseus:${crypto.randomUUID()}:`;
		const store = new RedisWorkflowStore({ prefix });
		await client.send('ZADD', [`${prefix}due:w`, String(now), 'ghost']);
		expect(await store.due(now, 10, ['w'])).toEqual([{ workflow: 'w', id: 'ghost' }]);
		expect(await store.claim('w', 'ghost', { owner: 'o', until: now + 1000 }, now)).toBeNull();
		expect(await store.due(now, 10, ['w'])).toEqual([]);
	});
});
