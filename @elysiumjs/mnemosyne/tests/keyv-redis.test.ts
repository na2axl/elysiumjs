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

import { Redis, Service } from '@elysiumjs/core';
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

import { KeyvRedis } from '../src/keyv-redis';

/** A Redis client stand-in holding its keys in a map. */
const fakeClient = () => {
	const data = new Map<string, string>();
	const remove = (...keys: string[]) => keys.filter((key) => data.delete(key)).length;
	const client = {
		data,
		set: mock(async (key: string, value: string) => {
			data.set(key, value);
			return 'OK';
		}),
		del: mock(async (...keys: string[]) => remove(...keys)),
		unlink: mock(async (...keys: string[]) => remove(...keys)),
		send: mock(async (command: string, args: string[]) => {
			if (command !== 'SCAN') return null;
			const prefix = args[args.indexOf('MATCH') + 1]!.replace(/\*$/, '');
			return ['0', [...data.keys()].filter((key) => key.startsWith(prefix))];
		})
	};
	return client;
};

describe('KeyvRedis', () => {
	let client: ReturnType<typeof fakeClient>;

	beforeEach(() => {
		client = fakeClient();
		Service.instance(Redis.getConnectionName('kv'), client);
	});

	afterEach(() => {
		Service.remove(Redis.getConnectionName('kv'));
	});

	const store = (options: { useUnlink?: boolean } = {}) =>
		new KeyvRedis({ connection: 'kv', namespace: 'ns', ...options });

	const seed = (...keys: string[]) => {
		for (const key of keys) client.data.set(key, 'value');
	};

	describe('delete', () => {
		it('unlinks the namespaced key', async () => {
			seed('ns::a');

			expect(await store().delete('a')).toBe(true);
			expect(client.unlink).toHaveBeenCalledWith('ns::a');
			expect(client.send).not.toHaveBeenCalled();
		});

		it('uses DEL when unlink is disabled', async () => {
			seed('ns::a');

			expect(await store({ useUnlink: false }).delete('a')).toBe(true);
			expect(client.del).toHaveBeenCalledWith('ns::a');
			expect(client.unlink).not.toHaveBeenCalled();
		});

		it('reports a missing key', async () => {
			expect(await store().delete('missing')).toBe(false);
		});
	});

	describe('deleteMany', () => {
		it('removes every key in one command', async () => {
			seed('ns::a', 'ns::b');

			expect(await store().deleteMany(['a', 'b', 'c'])).toBe(true);
			expect(client.unlink).toHaveBeenCalledTimes(1);
			expect(client.unlink).toHaveBeenCalledWith('ns::a', 'ns::b', 'ns::c');
		});

		it('uses DEL when unlink is disabled', async () => {
			seed('ns::a');

			expect(await store({ useUnlink: false }).deleteMany(['a', 'b'])).toBe(true);
			expect(client.del).toHaveBeenCalledWith('ns::a', 'ns::b');
		});

		it('reports when no key was removed', async () => {
			expect(await store().deleteMany(['missing'])).toBe(false);
		});

		it('sends nothing for an empty list', async () => {
			expect(await store().deleteMany([])).toBe(false);
			expect(client.unlink).not.toHaveBeenCalled();
		});
	});

	describe('clear', () => {
		it('removes the keys of its namespace only, one command per batch', async () => {
			seed('ns::a', 'ns::b', 'other::a');

			await store().clear();

			expect([...client.data.keys()]).toEqual(['other::a']);
			expect(client.unlink).toHaveBeenCalledTimes(1);
			expect(client.unlink).toHaveBeenCalledWith('ns::a', 'ns::b');
		});

		it('reports a failed delete as an error event', async () => {
			seed('ns::a');
			const failure = new Error('READONLY');
			client.unlink.mockImplementation(async () => {
				throw failure;
			});
			const kv = store();
			const errors: unknown[] = [];
			kv.on('error', (error) => errors.push(error));

			await kv.clear();

			expect(errors).toEqual([failure]);
		});
	});
});
