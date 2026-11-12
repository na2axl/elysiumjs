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

import { runtime as runtimeNode } from '@elysiumjs/runtime-node';
import { describe, expect, it } from 'vitest';

import { runScenario, scenarios } from '../../src/scenarios';

const expectAdapter: AssertAdapter = {
	equal: (a, b, msg) => {
		expect(a, msg).toEqual(b);
	}
};

describe('conformance (Node)', () => {
	it('runs on Node, not Bun', () => {
		expect(process.versions.bun).toBeUndefined();
		expect(process.versions.node).toBeDefined();
	});

	for (const s of scenarios) {
		it(s.name, () => runScenario(s, runtimeNode, expectAdapter));
	}
});
