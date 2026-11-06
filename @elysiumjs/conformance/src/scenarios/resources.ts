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

import { Application, Http, Module, Resource } from '@elysiumjs/core';
import { t } from 'elysia';

const PostResource = t.Object({
	id: t.String(),
	title: t.String(),
	publishedAt: t.String({ format: 'date' }),
	authorToken: Resource.hidden(t.String())
});

const make = async (): Promise<Application> => {
	const post = {
		id: 'p1',
		title: 'Hello',
		publishedAt: new Date('2026-11-06T10:00:00.000Z'),
		authorToken: 'secret',
		draft: false
	};

	@Http.controller({ path: '/posts' })
	class PostController {
		@Http.get({ path: '/:id', response: PostResource })
		public show() {
			return post;
		}

		@Http.get({ path: '/', response: t.Array(PostResource) })
		public list() {
			return [post, { ...post, id: 'p2', title: 'World' }];
		}
	}

	@Module.register({ controllers: [PostController] })
	class PostModule extends Module {}

	@Application.register({ modules: [PostModule], openapi: false })
	class ResourceApp extends Application {}

	return new ResourceApp();
};

/**
 * Handler results are serialized through the response schema: undeclared and hidden fields are
 * dropped, dates become strings, and `?fields=` keeps only the selected fields.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export const resources: Scenario = {
	name: 'resources: responses are serialized through their schema',
	app: make,
	requests: [
		{
			request: () => new Request('http://localhost/posts/p1'),
			expect: {
				status: 200,
				json: { id: 'p1', title: 'Hello', publishedAt: '2026-11-06' }
			}
		},
		{
			request: () => new Request('http://localhost/posts?fields=id,title'),
			expect: {
				status: 200,
				json: [
					{ id: 'p1', title: 'Hello' },
					{ id: 'p2', title: 'World' }
				]
			}
		},
		{
			request: () => new Request('http://localhost/posts/p1?fields=authorToken'),
			expect: { status: 400, headers: { 'content-type': 'application/problem+json' } }
		}
	]
};
