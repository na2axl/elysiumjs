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

import { runInvocation, WorkersRateLimitStore } from '../src';

const ctx = () => ({ waitUntil() {}, passThroughOnException() {} });

describe('WorkersRateLimitStore', () => {
	it('asks the binding of the invocation whether the key is over its limit', async () => {
		const keys: string[] = [];
		const OTP_LIMITER = {
			async limit({ key }: { key: string }) {
				keys.push(key);
				return { success: keys.filter((k) => k === key).length <= 2 };
			}
		};
		const store = new WorkersRateLimitStore({ binding: 'OTP_LIMITER' });

		const hits = await runInvocation({ env: { OTP_LIMITER }, ctx: ctx() }, async () => [
			await store.hit('a'),
			await store.hit('a'),
			await store.hit('a'),
			await store.hit('b')
		]);

		expect(hits).toEqual([
			{ limited: false },
			{ limited: false },
			{ limited: true },
			{ limited: false }
		]);
		expect(keys).toEqual(['a', 'a', 'a', 'b']);
	});
});
