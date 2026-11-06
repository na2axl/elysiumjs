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

import { Application, Http, Module, Service } from '@elysiumjs/core';

const make = async (): Promise<Application> => {
	let failuresLeft = 1;

	@Service.register({ name: 'conformance.store', global: true })
	class Store {
		public ready = false;

		public async onInit() {
			await new Promise<void>((resolve) => setTimeout(resolve, 1));
			this.ready = true;
		}
	}

	@Http.controller({ path: '/health' })
	class HealthController {
		@Http.get()
		public show() {
			return { ok: true };
		}
	}

	@Module.register({ services: [Store], controllers: [HealthController] })
	class FlakyModule extends Module {
		public async onInit() {
			await new Promise<void>((resolve) => setTimeout(resolve, 1));
			if (failuresLeft-- > 0) throw new Error('module failed');
		}
	}

	@Application.register({ modules: [FlakyModule], openapi: false })
	class FlakyApp extends Application {}

	return new FlakyApp();
};

const health = () => new Request('http://localhost/health');

/**
 * An application whose boot failed boots again on a later request.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export const lifecycle: Scenario = {
	name: 'lifecycle: boot retry after a failed onInit',
	app: make,
	requests: [
		{ request: health, expect: { status: 500 } },
		{ request: health, expect: { status: 200, json: { ok: true } } }
	]
};
