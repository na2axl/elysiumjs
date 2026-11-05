// Copyright (c) 2026-present Workbud Technologies Inc. All rights reserved.
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

import type { ModuleRoutes } from '../src/routes/render';

import { join } from 'node:path';

import { Application, Http, Module } from '@elysiumjs/core';
import { describe, expect, it } from 'bun:test';

import { collectRoutes } from '../src/routes/collect';
import { renderRoutes } from '../src/routes/render';
import { RoutesApp } from './fixtures/routes-app/src/app';

const fixture = join(import.meta.dir, 'fixtures', 'routes-app');
const outFile = join(fixture, 'src', 'routes.gen.ts');

describe('collectRoutes', () => {
	it('reads the modules, controllers and routes of an app', async () => {
		const { modules, missing } = await collectRoutes(fixture, RoutesApp, outFile);

		expect(missing).toEqual([]);
		expect(modules).toEqual([
			{
				id: 'BlogModule',
				prefix: '/api',
				controllers: [
					{
						exportName: 'PostController',
						specifier: './controllers/post.controller',
						path: '/posts',
						routes: [
							{
								name: 'show',
								method: 'GET',
								path: '/:id',
								sse: false,
								body: undefined,
								query: undefined,
								params: [{ slug: 'id', index: 0 }]
							},
							{
								name: 'create',
								method: 'POST',
								path: '/',
								sse: false,
								body: 0,
								query: 1,
								params: []
							}
						]
					}
				]
			}
		]);
	});

	it('reports controllers declared outside the project sources', async () => {
		@Http.controller({ path: '/inline' })
		class InlineController {
			@Http.get()
			public index() {
				return 'inline';
			}
		}

		@Module.register({ controllers: [InlineController] })
		class InlineModule extends Module {}

		@Application.register({ modules: [InlineModule], openapi: false })
		class InlineApp extends Application {}

		const { modules, missing } = await collectRoutes(fixture, InlineApp, outFile);

		expect(modules).toEqual([]);
		expect(missing).toEqual(['InlineController']);
	});
});

describe('renderRoutes', () => {
	const route = (overrides: Partial<ModuleRoutes['controllers'][number]['routes'][number]>) => ({
		name: 'index',
		method: 'GET',
		path: '/',
		sse: false,
		params: [],
		...overrides
	});

	it('writes a type-only chain per module with types from the method signatures', () => {
		const output = renderRoutes([
			{
				id: 'BlogModule',
				prefix: '/api',
				controllers: [
					{
						exportName: 'PostController',
						specifier: './controllers/post.controller',
						path: '/posts',
						routes: [
							route({ name: 'list' }),
							route({
								name: 'update',
								method: 'PATCH',
								path: '/:id/:slug',
								body: 1,
								query: 2,
								params: [{ slug: 'id', index: 0 }]
							})
						]
					}
				]
			}
		]);

		expect(output).toContain(
			"import type { PostController } from './controllers/post.controller';"
		);
		expect(output).toContain("const BlogModuleRoutes = () =>\n\troutes('/api')");
		expect(output).toContain(".get('/', {}, returns<ReturnType<PostController['list']>>())");
		expect(output).toContain(
			".patch('/:id/:slug', { params: schema<{ 'id': Parameters<PostController['update']>[0]; 'slug': string }>(), query: schema<Parameters<PostController['update']>[2]>(), body: schema<Parameters<PostController['update']>[1]>() }, returns<ReturnType<PostController['update']>>())"
		);
		expect(output).toContain('const app = () => routes().use(BlogModuleRoutes());');
		expect(output).toContain('export type AppRoutes = ReturnType<typeof app>;');
	});

	it('aliases controllers with the same name and uses route() for other methods', () => {
		const controller = (specifier: string) => ({
			exportName: 'HomeController',
			specifier,
			path: '/',
			routes: [route({ method: 'TRACE' })]
		});
		const output = renderRoutes([
			{ id: 'a-module', controllers: [controller('./a/home.controller')] },
			{ id: 'b-module', controllers: [controller('./b/home.controller')] }
		]);

		expect(output).toContain("import type { HomeController } from './a/home.controller';");
		expect(output).toContain(
			"import type { HomeController as HomeController$2 } from './b/home.controller';"
		);
		expect(output).toContain(
			".route('TRACE', '/', {}, returns<ReturnType<HomeController$2['index']>>())"
		);
		expect(output).toContain(
			'const app = () => routes().use(a_moduleRoutes()).use(b_moduleRoutes());'
		);
	});
});
