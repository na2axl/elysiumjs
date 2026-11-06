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

import { describe, expect, it } from 'bun:test';

import { KvSessionStore } from '../src';

describe('KvSessionStore', () => {
	it('keeps sessions in Workers KV, with at least the KV minimum expiry', async () => {
		const puts: unknown[] = [];
		const values = new Map<string, string>();
		const kv = {
			get: async (key: string) => values.get(key) ?? null,
			async put(key: string, value: string, options?: { expirationTtl?: number }) {
				puts.push(options);
				values.set(key, value);
			},
			delete: async (key: string) => void values.delete(key)
		};
		const store = new KvSessionStore({ namespace: kv, prefix: 's:' });
		await store.save('id', { b: 2 }, 10);
		expect(puts).toEqual([{ expirationTtl: 60 }]);
		expect(await store.load('id')).toEqual({ b: 2 });
		await store.destroy('id');
		expect(await store.load('id')).toBeNull();
	});
});
