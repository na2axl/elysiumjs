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

import { rm } from 'node:fs/promises';
import { join } from 'node:path';

import { Application, Http, Module, t } from '@elysiumjs/core';
import { afterAll, describe, expect, it } from 'bun:test';

import { routesWithoutResponse } from '../src/routes/check';
import { collectRoutes } from '../src/routes/collect';
import { renderRoutes } from '../src/routes/render';
import { ContribApp } from './fixtures/contrib-app/src/app';
import { DefaultApp } from './fixtures/default-app/src/app';
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
								status: undefined,
								responds: false,
								body: undefined,
								query: undefined,
								params: [{ slug: 'id', index: 0 }]
							},
							{
								name: 'create',
								method: 'POST',
								path: '/',
								sse: false,
								status: undefined,
								responds: false,
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
		@Http.controller('/inline')
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

describe('default exported controllers', () => {
	it('routes:generate imports a default-exported controller under its class name', async () => {
		const fixtureDir = join(import.meta.dir, 'fixtures', 'default-app');
		const out = join(fixtureDir, 'src', 'routes.gen.ts');
		const { modules } = await collectRoutes(fixtureDir, DefaultApp, out);
		const output = renderRoutes(modules);

		expect(output).toContain("import type { default as PostController } from './post.controller';");
		expect(output).not.toContain('import type { default }');
		expect(output).toContain("PostController['list']");
	});

	it('names an anonymous default-exported controller after its file', async () => {
		const fixtureDir = join(import.meta.dir, 'fixtures', 'default-app');
		const out = join(fixtureDir, 'src', 'routes.gen.ts');
		const { modules } = await collectRoutes(fixtureDir, DefaultApp, out);
		const output = renderRoutes(modules);

		expect(output).toContain(
			"import type { default as UserProfileController } from './user-profile.controller';"
		);
		expect(output).toContain("UserProfileController['show']");
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

describe('route types contributors', () => {
	const fixtureDir = join(import.meta.dir, 'fixtures', 'contrib-app');
	const out = join(fixtureDir, 'src', 'routes.gen.ts');
	const check = join(fixtureDir, 'src', 'check.ts');

	afterAll(async () => {
		await rm(out, { force: true });
		await rm(check, { force: true });
	});

	it('finds controllers in the files the app loaded, whatever declares them', async () => {
		const { modules, missing } = await collectRoutes(fixtureDir, ContribApp, out);
		const [greeting, health] = modules[0]!.controllers;

		expect(missing).toEqual([]);
		expect(greeting).toMatchObject({
			exportName: 'GreetingController',
			specifier: './greeting',
			path: '/greetings',
			types: {
				'ping:route': { response: 'Pong', imports: [{ from: './pong', names: ['Pong'] }] },
				hello: { response: "{ reply: ReturnType<__Controller__['hello']> }" }
			}
		});
		// The factory-built controller is not imported: the contributor types all its routes.
		expect(health).toMatchObject({ className: 'HealthController', path: '/health' });
		expect(health!.specifier).toBeUndefined();
	});

	it('renders the types of contributors, which compile', async () => {
		const { modules } = await collectRoutes(fixtureDir, ContribApp, out);
		const output = renderRoutes(modules);

		expect(output).toContain("import type { Pong } from './pong';");
		expect(output).toContain("import type { GreetingController } from './greeting';");
		expect(output).not.toContain('HealthController');
		expect(output).toContain(".get('/ping', {}, returns<Pong>())");
		expect(output).toContain(
			".get('/hello', {}, returns<{ reply: ReturnType<GreetingController['hello']> }>())"
		);

		await Bun.write(out, output);
		await Bun.write(
			check,
			[
				"import type { AppRoutes } from './routes.gen';",
				'',
				"type Routes = AppRoutes['~Routes'];",
				"export const pong: Routes['health']['ping']['get']['response'][200] = { pong: true };",
				"export const reply: Routes['greetings']['hello']['get']['response'][200] = { reply: 'hi' };",
				'// @ts-expect-error The reply of /hello is a string.',
				"export const wrong: Routes['greetings']['hello']['get']['response'][200] = { reply: 1 };",
				''
			].join('\n')
		);
		const result = Bun.spawnSync([process.execPath, 'x', 'tsc', '-p', 'tsconfig.json'], {
			cwd: fixtureDir
		});
		expect({ output: result.stdout.toString(), code: result.exitCode }).toEqual({
			output: '',
			code: 0
		});
	});
});

describe('routesWithoutResponse', () => {
	it('lists the routes without a success response schema, with their full path', async () => {
		expect(await routesWithoutResponse(RoutesApp)).toEqual([
			{
				module: 'BlogModule',
				controller: 'PostController',
				handler: 'show',
				method: 'GET',
				path: '/api/posts/:id'
			},
			{
				module: 'BlogModule',
				controller: 'PostController',
				handler: 'create',
				method: 'POST',
				path: '/api/posts'
			}
		]);
	});

	it('accepts declared responses, and leaves out 204 and server-sent events routes', async () => {
		@Http.controller('/checked')
		class CheckedController {
			@Http.get('/', { response: t.Object({ ok: t.Boolean() }) })
			public index() {
				return { ok: true };
			}

			@Http.post('/', { status: 201, response: { 201: t.Object({ id: t.String() }) } })
			public create() {
				return { id: '1' };
			}

			@Http.put('/', { response: { 409: t.Object({ code: t.String() }) } })
			public update() {
				return { code: 'conflict' };
			}

			@Http.del('/', { status: 204 })
			public remove() {}

			@Http.sse('/events')
			public async *events() {
				yield 'ping';
			}
		}

		@Module.register({ controllers: [CheckedController] })
		class CheckedModule extends Module {}

		@Application.register({ modules: [CheckedModule], openapi: false })
		class CheckedApp extends Application {}

		expect(await routesWithoutResponse(CheckedApp)).toEqual([
			{
				module: 'CheckedModule',
				controller: 'CheckedController',
				handler: 'update',
				method: 'PUT',
				path: '/checked'
			}
		]);
	});
});
