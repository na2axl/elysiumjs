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

import { Application, Http, Module } from '@elysiumjs/core';

const make = async (): Promise<Application> => {
	@Http.controller('/boom')
	class BoomController {
		@Http.get()
		public explode() {
			throw new Error('boom');
		}
	}

	@Module.register({ controllers: [BoomController] })
	class BoomModule extends Module {}

	@Application.register({ modules: [BoomModule], openapi: false })
	class BoomApp extends Application {}

	return new BoomApp();
};

/**
 * A thrown error gives a 500.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export const errors: Scenario = {
	name: 'errors: a thrown error gives 500',
	app: make,
	requests: [{ request: () => new Request('http://localhost/boom'), expect: { status: 500 } }]
};
