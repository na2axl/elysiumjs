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

import type { Scenario } from './types';

import {
	Application,
	Http,
	HttpControllerScope,
	Module,
	Service,
	ServiceScope
} from '@elysiumjs/core';

import { waitFor } from './wait';

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 5));

const makeScopes = async (): Promise<Application> => {
	let factories = 0;

	@Service.register()
	class Single {
		public readonly id = 'single';
	}

	@Service.register({ scope: ServiceScope.FACTORY })
	class Made {
		public readonly id = ++factories;
	}

	@Service.register({ scope: ServiceScope.REQUEST })
	class Session {
		public ready = false;

		public async onInit() {
			await tick();
			this.ready = true;
		}
	}

	@Http.controller({ path: '/di', scope: HttpControllerScope.REQUEST })
	class DiController {
		constructor(@Service.inject(Session) public session: Session) {}

		@Http.get()
		public show(
			@Service.inject(Single) single: Single,
			@Service.inject(Made) made: Made,
			@Service.inject(Session) session: Session
		) {
			return {
				single: single.id,
				made: made.id,
				ready: session.ready,
				ctorReady: this.session.ready,
				same: session === this.session
			};
		}
	}

	@Module.register({ services: [Single, Made, Session], controllers: [DiController] })
	class DiModule extends Module {}

	@Application.register({ modules: [DiModule], openapi: false })
	class DiApp extends Application {}

	return new DiApp();
};

const get = (path: string) => () => new Request(`http://localhost${path}`);

/**
 * Singleton, factory and request scopes, the latter with an async `onInit`.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export const diScopes: Scenario = {
	name: 'di-scopes: singleton, factory and request with async onInit',
	app: makeScopes,
	requests: [
		{
			request: get('/di'),
			expect: {
				status: 200,
				json: { single: 'single', made: 1, ready: true, ctorReady: true, same: true }
			}
		},
		{
			request: get('/di'),
			expect: {
				status: 200,
				json: { single: 'single', made: 2, ready: true, ctorReady: true, same: true }
			}
		}
	]
};

const destroyed: string[] = [];

const makeDisposal = async (): Promise<Application> => {
	destroyed.length = 0;

	@Service.register({ scope: ServiceScope.REQUEST })
	class Inner {
		public onDestroy() {
			destroyed.push('Inner');
		}
	}

	@Service.register({ scope: ServiceScope.REQUEST })
	class Outer {
		constructor(@Service.inject(Inner) public inner: Inner) {}

		public onDestroy() {
			destroyed.push('Outer');
		}
	}

	@Http.controller({ path: '/dispose' })
	class DisposeController {
		@Http.get({ path: '/ok' })
		public ok(@Service.inject(Outer) outer: Outer) {
			return { ok: !!outer };
		}

		@Http.get({ path: '/fail' })
		public fail(@Service.inject(Outer) _outer: Outer) {
			throw new Error('handler failed');
		}
	}

	@Module.register({ services: [Inner, Outer], controllers: [DisposeController] })
	class DisposeModule extends Module {}

	@Application.register({ modules: [DisposeModule], openapi: false })
	class DisposeApp extends Application {}

	return new DisposeApp();
};

/**
 * Request-scoped services are destroyed, in reverse order, after the response, also on failure.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export const diDisposal: Scenario = {
	name: 'di-scopes: request-scoped services are destroyed after the response',
	app: makeDisposal,
	requests: [
		{ request: get('/dispose/ok'), expect: { status: 200, json: { ok: true } } },
		{ request: get('/dispose/fail'), expect: { status: 500 } }
	],
	after: async (_app, assert) => {
		const expected = ['Outer', 'Inner', 'Outer', 'Inner'];
		await waitFor(() => destroyed.length >= expected.length);
		assert.equal(destroyed.join(','), expected.join(','), 'destroy order');
	}
};
