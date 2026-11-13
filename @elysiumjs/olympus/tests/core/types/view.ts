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

// Compile-time checks: run by `bun run typecheck`, not by `bun test`.
import type { ViewOutput, ViewResponseOf } from '../../../src/index';

import { t } from 'elysia';

import { Http, View } from '../../../src/index';

type Post = { id: string; title: string; publishedAt: Date | null };

export class PostView extends View(
	t.Object({
		id: t.String(),
		title: t.String(),
		publishedAt: t.Nullable(t.String({ format: 'date-time' })),
		tags: t.Array(t.Object({ name: t.String(), at: t.String({ format: 'date' }) }))
	})
) {
	public static override render(post: Post): ViewOutput<typeof PostView.schema> {
		return { id: post.id, title: post.title, publishedAt: post.publishedAt, tags: [] };
	}
}

// A string field, such as a date-time or a date, takes a Date or a string, at any depth.
export const withDates: ViewOutput<typeof PostView.schema> = {
	id: '1',
	title: 'a',
	publishedAt: new Date(),
	tags: [{ name: 'x', at: new Date() }]
};
export const withStrings: ViewOutput<typeof PostView.schema> = {
	id: '1',
	title: 'a',
	publishedAt: '2026-01-01T00:00:00Z',
	tags: [{ name: 'x', at: '2026-01-01' }]
};
// @ts-expect-error a number field does not take a string
export const badId: ViewOutput<typeof BadView.schema> = { id: 1, count: '1' };

export class BadView extends View(t.Object({ id: t.Number(), count: t.Number() })) {
	public static override render(post: Post): ViewOutput<typeof BadView.schema> {
		// @ts-expect-error render answers what the schema declares
		return { id: post.title, count: 1 };
	}
}

// renderAll and renderPage take the input of render and answer its output.
export const all: ViewOutput<typeof PostView.schema>[] = PostView.renderAll([
	{ id: '1', title: 'a', publishedAt: null }
]);
// @ts-expect-error renderAll takes the inputs of render
PostView.renderAll([{ id: 1 }]);

// Clients receive the static type of the schema: dates as strings.
export const one: ViewResponseOf<typeof PostView, 'one'> = {
	id: '1',
	title: 'a',
	publishedAt: null,
	tags: []
};
// @ts-expect-error clients receive dates as strings
export const oneDate: ViewResponseOf<typeof PostView, 'one'> = { ...one, publishedAt: new Date() };
export const list: ViewResponseOf<typeof PostView, 'list'> = [one];
export const cursor: ViewResponseOf<typeof PostView, 'cursor'> = { data: [one], nextCursor: null };
export const offset: ViewResponseOf<typeof PostView, 'offset'> = {
	data: [one],
	page: 1,
	limit: 20,
	total: 1
};

// Routes take a view, its list or its page as their response.
export class PostController {
	@Http.get('/:id', { response: PostView })
	public show(): Post {
		return { id: '1', title: 'a', publishedAt: null };
	}

	@Http.get('/', { response: PostView.list })
	public list(): Post[] {
		return [];
	}

	@Http.get('/page', { response: PostView.page })
	public page() {
		return { data: [] as Post[], nextCursor: null };
	}
}

// renderPage keeps the kind of its page, and takes readonly items.
const items: readonly Post[] = [];
export const cursorPage: string | null = PostView.renderPage({
	data: items,
	nextCursor: null
}).nextCursor;
export const offsetTotal: number = PostView.renderPage({
	data: items,
	page: 1,
	limit: 1,
	total: 0
}).total;
// @ts-expect-error a cursor page has no total
PostView.renderPage({ data: items, nextCursor: null }).total;

// Tuples keep their positions.
export class PairView extends View(t.Object({ pair: t.Tuple([t.String(), t.Number()]) })) {
	public static override render(): ViewOutput<typeof PairView.schema> {
		return { pair: [new Date(), 1] };
	}
}
// @ts-expect-error the second position is a number
export const badPair: ViewOutput<typeof PairView.schema> = { pair: ['a', 'b'] };

// A page of either pagination, for a route whose query gives none.
export const either: ViewResponseOf<typeof PostView, 'page'>[] = [cursor, offset];
