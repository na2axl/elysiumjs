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
	@Http.controller('/items')
	class ItemsController {
		@Http.get('/:id')
		public show(@Http.param('id') id: string, @Http.query(t.Object({ q: t.String() })) query: any) {
			return { id, q: query.q };
		}

		@Http.post('/')
		public create(@Http.body(t.Object({ name: t.String() })) body: { name: string }) {
			return { created: body.name };
		}
	}

	@Module.register({ controllers: [ItemsController] })
	class RoutingModule extends Module {}

	@Application.register({ modules: [RoutingModule], openapi: false })
	class RoutingApp extends Application {}

	return new RoutingApp();
};

/**
 * Params, query and body reach the handler.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export const routing: Scenario = {
	name: 'routing: params, query and body',
	app: make,
	requests: [
		{
			request: () => new Request('http://localhost/items/42?q=hello'),
			expect: { status: 200, json: { id: '42', q: 'hello' } }
		},
		{
			request: () =>
				new Request('http://localhost/items', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ name: 'widget' })
				}),
			expect: { status: 200, json: { created: 'widget' } }
		}
	]
};
