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

import type { AssertAdapter } from '../../src/scenarios';

import { env } from 'cloudflare:test';
import { describe, expect, inject, it } from 'vitest';

import { checkRequests, scenarios } from '../../src/scenarios';

type Fetcher = { fetch(request: Request): Promise<Response> };

const expectAdapter: AssertAdapter = {
	equal: (a, b, msg) => {
		expect(a, msg).toEqual(b);
	}
};

describe('conformance (workerd, AOT)', () => {
	const built = inject('aotScenarios' as never) as string[];

	it('built a Worker for every scenario', () => {
		expect(built).toEqual(scenarios.map((s) => s.name));
	});

	scenarios.forEach((s, index) => {
		it(s.name, async () => {
			const worker = (env as Record<string, Fetcher>)[`AOT_${index}`]!;
			// The app runs in the Worker; the requests and the `after` assertions go to it.
			await checkRequests(s, (request) => worker.fetch(request), expectAdapter);
			const failures = await (await worker.fetch(new Request('http://localhost/__after'))).json();
			expect(failures, `${s.name}: after`).toEqual([]);
		});
	});
});
