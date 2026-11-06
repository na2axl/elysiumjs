// Copyright (c) 2025-present Workbud Technologies Inc. All rights reserved.
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

import type { WorkersExecutionContext } from '@elysiumjs/runtime-workers';
import type { AssertAdapter, ScenarioDriver } from '../../src/scenarios';

import { createWorker, runtime as runtimeWorkers } from '@elysiumjs/runtime-workers';
import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { runScenario, scenarios } from '../../src/scenarios';

const expectAdapter: AssertAdapter = {
	equal: (a, b, msg) => {
		expect(a, msg).toEqual(b);
	}
};

/**
 * Drives each request through the Worker's `fetch`, each in an execution context of its own, as
 * workerd would. The contexts are kept so that the test waits on their `waitUntil` work.
 */
const workerDriver = (contexts: WorkersExecutionContext[]): ScenarioDriver => {
	return async (app) => {
		const worker = await createWorker(app);
		return (request) => {
			const ctx = createExecutionContext();
			contexts.push(ctx);
			return worker.fetch(request, env, ctx);
		};
	};
};

describe('conformance (workerd)', () => {
	it('runs on workerd, not Bun or Node.js', () => {
		expect(navigator.userAgent).toBe('Cloudflare-Workers');
	});

	for (const s of scenarios) {
		it(s.name, async () => {
			const contexts: WorkersExecutionContext[] = [];
			try {
				await runScenario(s, runtimeWorkers, expectAdapter, workerDriver(contexts));
			} finally {
				await Promise.all(contexts.map((ctx) => waitOnExecutionContext(ctx)));
			}
		});
	}
});
