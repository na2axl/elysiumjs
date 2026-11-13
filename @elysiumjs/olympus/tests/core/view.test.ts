// Copyright (c) 2026-present Axel Nana <ax.lnana@outlook.com>. All rights reserved.
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

import { afterEach, describe, expect, it } from 'bun:test';

import { Application, Http, Module, t, View, ViewNotRenderableError, Views } from '../../src/index';

type Post = { id: string; title: string; secret: string; publishedAt: Date };

const PostSchema = t.Object({
	id: t.String(),
	title: t.String(),
	publishedAt: t.String({ format: 'date-time' })
});

class PostView extends View(PostSchema) {
	public static override render(post: Post) {
		return { id: post.id, title: post.title.toUpperCase(), publishedAt: post.publishedAt };
	}
}

class EmptyView extends View(t.Object({})) {}

const at = new Date('2026-01-02T03:04:05.000Z');
const post = (id: string): Post => ({ id, title: `post ${id}`, secret: 's', publishedAt: at });
const rendered = (id: string) => ({
	id,
	title: `POST ${id}`,
	publishedAt: '2026-01-02T03:04:05.000Z'
});

@Http.controller('/posts')
class PostController {
	@Http.get('/one', { response: PostView })
	public one() {
		return post('1');
	}

	@Http.get('/list', { response: PostView.list })
	public list() {
		return [post('1'), post('2')];
	}

	@Http.get('/cursor', { response: PostView.page })
	public cursor(@Http.query(t.Object({ cursor: t.Optional(t.String()) })) _query: unknown) {
		return { data: [post('1')], nextCursor: 'next' };
	}

	@Http.get('/offset', { response: PostView.page })
	public offset(@Http.query(t.Object({ page: t.Optional(t.String()) })) _query: unknown) {
		return { data: [post('1')], page: 2, limit: 1, total: 3 };
	}

	@Http.get('/response')
	public response() {
		return new Response('raw');
	}
}

@Module.register({ controllers: [PostController] })
class PostModule extends Module {}

@Application.register({ modules: [PostModule], openapi: false })
class PostApp extends Application {}

describe('View', () => {
	it('renders lists and pages with render, keeping the pagination and symbols of a page', () => {
		expect(PostView.renderAll([post('1')])).toEqual([
			{ id: '1', title: 'POST 1', publishedAt: at }
		]);
		const brand = Symbol('brand');
		const page = PostView.renderPage({
			data: [post('1')],
			nextCursor: null,
			[brand]: 'x'
		} as never);
		expect(page.data).toEqual([{ id: '1', title: 'POST 1', publishedAt: at }]);
		expect((page as { nextCursor: string | null }).nextCursor).toBeNull();
		expect((page as unknown as Record<symbol, unknown>)[brand]).toBe('x');
	});

	it('throws when a view has no render method', () => {
		expect(() => EmptyView.render({})).toThrow(ViewNotRenderableError);
	});

	it('describes list and page responses, and tells views apart', () => {
		expect(Views.isView(PostView)).toBe(true);
		expect(Views.isView(class {})).toBe(false);
		expect(Views.of(PostView.list)).toEqual({ view: PostView, kind: 'list' });
		expect(Views.of(PostView.page)).toEqual({ view: PostView, kind: 'page' });
		expect(Views.of(PostSchema)).toBeUndefined();
	});

	it('reads the pagination of a page from the query schema', () => {
		expect(Views.paginationOf(t.Object({ page: t.Optional(t.String()) }))).toBe('offset');
		expect(Views.paginationOf(t.Object({ cursor: t.Optional(t.String()) }))).toBe('cursor');
		expect(Views.paginationOf(undefined)).toBe('cursor');
	});
});

describe('View over HTTP', () => {
	let testing: { shutdown(): Promise<void>; http: any } | undefined;

	afterEach(async () => {
		await testing?.shutdown();
		testing = undefined;
	});

	it('renders one item through the view schema, with dates as ISO strings', async () => {
		testing = await Application.testing({ app: PostApp });
		const response = await testing.http.get('/posts/one');
		expect(await response.json()).toEqual(rendered('1'));
	});

	it('renders a list', async () => {
		testing = await Application.testing({ app: PostApp });
		const response = await testing.http.get('/posts/list');
		expect(await response.json()).toEqual([rendered('1'), rendered('2')]);
	});

	it('renders a cursor page and an offset page', async () => {
		testing = await Application.testing({ app: PostApp });
		const cursor = await testing.http.get('/posts/cursor');
		expect(await cursor.json()).toEqual({ data: [rendered('1')], nextCursor: 'next' });
		const offset = await testing.http.get('/posts/offset');
		expect(await offset.json()).toEqual({ data: [rendered('1')], page: 2, limit: 1, total: 3 });
	});

	it('describes the view of each route, with the pagination of its pages', () => {
		const routes = Http.describe(PostController)!.routes;
		const view = (name: string) => routes.find((route) => route.name === name)?.view;
		expect(view('one')).toEqual({ view: PostView, kind: 'one', pagination: 'cursor' });
		expect(view('list')).toEqual({ view: PostView, kind: 'list', pagination: 'cursor' });
		expect(view('offset')).toEqual({ view: PostView, kind: 'page', pagination: 'offset' });
		expect(view('response')).toBeUndefined();
		expect(routes.find((route) => route.name === 'one')?.responds).toBe(true);
	});
});
