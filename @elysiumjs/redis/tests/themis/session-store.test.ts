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

import { describe, expect, it } from 'bun:test';

import { RedisSessionStore } from '../../src';

describe('RedisSessionStore', () => {
	it('keeps sessions in Redis with an expiry', async () => {
		const calls: unknown[][] = [];
		const values = new Map<string, string>();
		const redis = {
			async send(command: string, args: string[]) {
				calls.push([command, ...args]);
				values.set(args[0]!, args[1]!);
			},
			get: async (key: string) => values.get(key) ?? null,
			del: async (key: string) => Number(values.delete(key))
		};
		const store = new RedisSessionStore({ connection: () => redis as never });
		await store.save('id', { a: 1 }, 60);
		expect(calls).toEqual([['SET', 'session:id', '{"a":1}', 'EX', '60']]);
		expect(await store.load('id')).toEqual({ a: 1 });
		await store.destroy('id');
		expect(await store.load('id')).toBeNull();
	});
});
