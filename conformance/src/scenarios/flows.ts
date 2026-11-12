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

import type { Scenario } from './types';

import {
	AriadneModule,
	Flow,
	FLOW_KEY_HEADER,
	FLOW_OWNER_HEADER,
	FLOW_STEP_HEADER,
	MemoryFlowStore
} from '@elysiumjs/olympus/ariadne';
import { Application, Http, Module, t } from '@elysiumjs/olympus';

type Greeting = { name: string };

const make = async (): Promise<Application> => {
	@Flow.controller('greeting', { ttl: 600, owner: 'guest' })
	class GreetingFlow {
		@Flow.initial()
		public initial(): Greeting {
			return { name: '' };
		}

		@Flow.step({ next: ['confirm'] })
		public name(
			@Http.body(t.Object({ name: t.String({ minLength: 1 }) })) { name }: { name: string },
			@Flow.state() state: Greeting
		) {
			return Flow.advance({ ...state, name }, { hello: name });
		}

		@Flow.step()
		public confirm(@Flow.state() state: Greeting) {
			return { done: state.name };
		}
	}

	@Module.register({ controllers: [GreetingFlow] })
	class GreetingModule extends Module {}

	@Application.register({
		modules: [AriadneModule.with({ store: new MemoryFlowStore() }), GreetingModule],
		openapi: false
	})
	class FlowApp extends Application {}

	return new FlowApp();
};

type Started = { flowKey: string; owner: string };

/** A step of the flow started by the first request. */
const step =
	(name: string, stepId: string, body: object = {}) =>
	(previous: unknown[]) => {
		const { flowKey, owner } = previous[0] as Started;
		return new Request(`http://localhost/flows/greeting/${name}`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				[FLOW_OWNER_HEADER]: owner,
				[FLOW_KEY_HEADER]: flowKey,
				[FLOW_STEP_HEADER]: stepId
			},
			body: JSON.stringify(body)
		});
	};

/**
 * A guest flow starts, runs a step, replays it for the same step id, refuses an unexpected step
 * (409) and another owner (403), and ends; then it is gone (410).
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export const flows: Scenario = {
	name: 'flows: guest flow with replay and unexpected step',
	app: make,
	requests: [
		{
			request: () => new Request('http://localhost/flows/greeting', { method: 'POST' }),
			expect: { status: 201, includes: { nextSteps: ['name'], backSteps: [] } }
		},
		{
			request: step('confirm', 's0'),
			expect: { status: 409, includes: { nextSteps: ['name'], type: 'flow-unexpected-step' } }
		},
		{
			request: step('name', 's1', { name: 'Ada' }),
			expect: {
				status: 200,
				json: { answer: { hello: 'Ada' }, nextSteps: ['confirm'], backSteps: [] }
			}
		},
		{
			request: step('name', 's1', { name: 'Ada' }),
			expect: {
				status: 200,
				json: { answer: { hello: 'Ada' }, nextSteps: ['confirm'], backSteps: [] }
			}
		},
		{
			request: (previous) => {
				const { flowKey } = previous[0] as Started;
				return new Request('http://localhost/flows/greeting', {
					headers: { [FLOW_OWNER_HEADER]: 'forged', [FLOW_KEY_HEADER]: flowKey }
				});
			},
			expect: { status: 403 }
		},
		{
			request: step('confirm', 's2'),
			expect: { status: 200, json: { answer: { done: 'Ada' }, nextSteps: [], backSteps: [] } }
		},
		{ request: step('name', 's3', { name: 'Grace' }), expect: { status: 410 } }
	]
};
