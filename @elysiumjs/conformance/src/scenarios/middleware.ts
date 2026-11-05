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

import { Application, Http, Middleware, Module } from '@elysiumjs/core';

const make = async (): Promise<Application> => {
	class Guard extends Middleware {
		public onRequest(ctx: any) {
			if (!ctx.request.headers.get('authorization')) {
				return ctx.status(401, { error: 'unauthorized' });
			}
		}
	}

	@Http.controller({ path: '/secret' })
	class SecretController {
		@Http.get()
		public show() {
			return { secret: 42 };
		}
	}

	@Module.register({ controllers: [SecretController] })
	class SecretModule extends Module {}

	@Middleware.register(Guard)
	@Application.register({ modules: [SecretModule], openapi: false })
	class GuardedApp extends Application {}

	return new GuardedApp();
};

/**
 * An `onRequest` middleware that returns a value stops the request.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export const middleware: Scenario = {
	name: 'middleware: onRequest stop gives 401',
	app: make,
	requests: [
		{
			request: () => new Request('http://localhost/secret'),
			expect: { status: 401, json: { error: 'unauthorized' } }
		},
		{
			request: () =>
				new Request('http://localhost/secret', { headers: { authorization: 'Bearer x' } }),
			expect: { status: 200, json: { secret: 42 } }
		}
	]
};
