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

import type { AssertAdapter, Scenario } from '../../src/scenarios';

import { Application, Http, Module, Service } from '@elysiumjs/core';
import { runtime as runtimeBun } from '@elysiumjs/runtime-bun';
import { describe, expect, it } from 'bun:test';

import { runScenario } from '../../src/scenarios';

const expectAdapter: AssertAdapter = {
	equal: (a, b, msg) => {
		expect(a, msg).toEqual(b);
	}
};

const makeApp = async (): Promise<Application> => {
	@Http.controller({ path: '/ping' })
	class PingController {
		@Http.get()
		public ping() {
			return 'pong';
		}
	}

	@Module.register({ controllers: [PingController] })
	class PingModule extends Module {}

	@Application.register({ modules: [PingModule], openapi: false })
	class PingApp extends Application {}

	return new PingApp();
};

describe('runScenario', () => {
	it('passes the assert adapter to the after hook', async () => {
		let received: AssertAdapter | undefined;
		const scenario: Scenario = {
			name: 'after receives assert',
			app: makeApp,
			requests: [],
			after: (_app, assert) => {
				received = assert;
			}
		};

		await runScenario(scenario, runtimeBun, expectAdapter);

		expect(received).toBe(expectAdapter);
	});

	it('resets the container when the app factory throws', async () => {
		const scenario: Scenario = {
			name: 'factory throws',
			app: async () => {
				Service.instance('conformance.leak', 1);
				throw new Error('factory failed');
			},
			requests: []
		};

		await expect(runScenario(scenario, runtimeBun, expectAdapter)).rejects.toThrow(
			'factory failed'
		);

		expect(Service.exists('conformance.leak')).toBe(false);
	});

	it('leaves no global service behind after a scenario', async () => {
		const scenario: Scenario = {
			name: 'leaves nothing behind',
			app: async () => {
				Service.instance('conformance.left', 1);
				return makeApp();
			},
			requests: [{ request: () => new Request('http://localhost/ping'), expect: { status: 200 } }]
		};

		await runScenario(scenario, runtimeBun, expectAdapter);

		expect(Service.keys('*')).toEqual([]);
	});
});
