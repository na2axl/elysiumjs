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

import { Application, Http, Module } from '@elysiumjs/core';
import { t } from 'elysia';

const make = async (): Promise<Application> => {
	@Http.controller('/users')
	class UsersController {
		@Http.get('/:id')
		public show(@Http.param('id', t.String()) id: string) {
			return { id };
		}
	}

	@Module.register({ controllers: [UsersController] })
	class DocsModule extends Module {}

	@Application.register({
		modules: [DocsModule],
		openapi: { path: '/docs', documentation: { info: { title: 'Docs', version: '1.0.0' } } }
	})
	class DocsApp extends Application {}

	return new DocsApp();
};

/**
 * The OpenAPI page and its spec are served on every runtime, compiled ahead of time included.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export const openapi: Scenario = {
	name: 'openapi: the docs page and its spec are served',
	app: make,
	requests: [
		{
			request: () => new Request('http://localhost/users/42'),
			expect: { status: 200, json: { id: '42' } }
		},
		{ request: () => new Request('http://localhost/docs/json'), expect: { status: 200 } },
		{
			request: () => new Request('http://localhost/docs'),
			expect: { status: 200, headers: { 'content-type': 'text/html; charset=utf8' } }
		}
	]
};
