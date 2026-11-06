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
import { t } from 'elysia';

const make = async (): Promise<Application> => {
	@Http.controller('/users')
	class UsersController {
		@Http.post('/')
		public create(@Http.body(t.Object({ age: t.Number() })) body: { age: number }) {
			return { age: body.age };
		}
	}

	@Module.register({ controllers: [UsersController] })
	class ValidationModule extends Module {}

	@Application.register({ modules: [ValidationModule], openapi: false })
	class ValidationApp extends Application {}

	return new ValidationApp();
};

const post = (body: unknown) => () =>
	new Request('http://localhost/users', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body)
	});

/**
 * A body that does not match its schema is refused with 422.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export const validation: Scenario = {
	name: 'validation: a bad body gives 422',
	app: make,
	requests: [
		{ request: post({ age: 'old' }), expect: { status: 422 } },
		{ request: post({ age: 30 }), expect: { status: 200, json: { age: 30 } } }
	]
};
