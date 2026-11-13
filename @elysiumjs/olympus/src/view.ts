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

import type { Static, TSchema } from 'typebox';

import { t } from 'elysia';

import { ElysiumError } from './errors';

/** The JSON Schema keyword that marks the schema of a page, with its pagination. */
export const PAGE_SCHEMA_KEYWORD = 'x-elysium-page';

/** How the pages of a list route are found: after a cursor, or by page number. */
export type ViewPagination = 'cursor' | 'offset';

/**
 * The response schema of a page of items.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @param item The schema of one item.
 * @param pagination The pagination of the page.
 */
export const pageResponseSchema = <S extends TSchema>(item: S, pagination: ViewPagination) =>
	pagination === 'offset'
		? t.Object(
				{
					data: t.Array(item),
					page: t.Integer({ minimum: 1 }),
					limit: t.Integer({ minimum: 1 }),
					total: t.Integer({ minimum: 0 })
				},
				{ [PAGE_SCHEMA_KEYWORD]: 'offset' }
			)
		: t.Object(
				{ data: t.Array(item), nextCursor: t.Nullable(t.String()) },
				{ [PAGE_SCHEMA_KEYWORD]: 'cursor' }
			);

/** Marks the classes made by {@link View}. */
const VIEW = Symbol.for('elysium:view');

/** Marks the responses `View.list` and `View.page` describe. */
const VIEW_RESPONSE = Symbol.for('elysium:view:response');

/**
 * Thrown when a view class does not define its `render` method.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class ViewNotRenderableError extends ElysiumError {
	constructor(view: string) {
		super(`The view ${view} has no static render() method.`);
	}
}

/**
 * Thrown when a handler answers a value a view cannot render: an item where a list or a page is
 * expected, or a page of the other pagination.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class ViewInputError extends ElysiumError {
	constructor(view: string, expected: string) {
		super(`The view ${view} expected ${expected} from the route's handler.`);
	}
}

/** Marks the `render` method of the base class, which every view replaces. */
const BASE_RENDER = Symbol.for('elysium:view:base-render');

/**
 * The value a view's `render` answers: the static type of its schema, where a string field may
 * also be given as a `Date`. A date is written as its ISO string when the response is
 * serialized, or as its day for a field of format `date`.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @template S The schema of the view.
 */
export type ViewOutput<S extends TSchema> = WithDates<Static<S>>;

type WithDates<T> = T extends string
	? string extends T
		? T | Date
		: T
	: T extends Date
		? T
		: T extends readonly unknown[]
			? { -readonly [K in keyof T]: WithDates<T[K]> }
			: T extends object
				? { [K in keyof T]: WithDates<T[K]> }
				: T;

/** A view class, as routes take it. */
export type ViewClass<S extends TSchema = TSchema> = {
	readonly name: string;
	readonly schema: S;
	render(input: never): unknown;
	renderAll(inputs: readonly never[]): unknown[];
	renderPage(page: never): unknown;
};

/** What a route answers with a view: one item, a list, or a page. */
export type ViewKind = 'one' | 'list' | 'page';

/**
 * A response rendered by a view, as a route's `response` takes it: `View.list` and `View.page`
 * of a view class.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type ViewResponse<V extends ViewClass = ViewClass> = {
	readonly [VIEW_RESPONSE]: true;
	readonly view: V;
	readonly kind: Exclude<ViewKind, 'one'>;
};

/** The input of a view's `render`. */
export type ViewInput<V> = V extends { render(input: infer I): unknown } ? I : never;

/** A page of items: cursor or offset. */
export type ViewPage<T> =
	| { data: readonly T[]; nextCursor: string | null }
	| { data: readonly T[]; page: number; limit: number; total: number };

/**
 * The response type of a route rendered by a view, as clients receive it: the static type of
 * the view's schema, for one item, a list or a page.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @template V The view class.
 * @template K One item, a list, a cursor or offset page, or a page of either (`page`).
 */
export type ViewResponseOf<
	V extends { schema: TSchema },
	K extends 'one' | 'list' | 'page' | ViewPagination
> = K extends 'one'
	? Static<V['schema']>
	: K extends 'list'
		? Static<V['schema']>[]
		: K extends 'offset'
			? { data: Static<V['schema']>[]; page: number; limit: number; total: number }
			: K extends 'cursor'
				? { data: Static<V['schema']>[]; nextCursor: string | null }
				: ViewResponseOf<V, ViewPagination>;

/** Copies the members of a page, its symbols included, with other items. */
const withItems = <T>(page: object, items: T[]) => {
	const copy = { ...page, data: items } as Record<string | symbol, unknown>;
	for (const symbol of Object.getOwnPropertySymbols(page)) {
		const descriptor = Object.getOwnPropertyDescriptor(page, symbol)!;
		Object.defineProperty(copy, symbol, descriptor);
	}
	return copy;
};

/**
 * Creates the base class of a view: how a resource is shown on the wire. A view declares the
 * schema of what it renders and writes one static `render` method; `renderAll` and `renderPage`
 * render lists and pages with it. Views have no instances and no dependencies: `render` reads
 * what it needs from its input, and from static APIs such as `Clock`, `Config` or other views.
 *
 * A route answers with a view by naming it as its `response`: `PostView` renders one item,
 * `PostView.list` a list, and `PostView.page` a page, whose pagination is read from the route's
 * query schema (offset when it has a `page` parameter, cursor otherwise). The handler returns
 * the input of `render`; what `render` answers goes through the route's interceptors and is
 * serialized through the view's schema, so hidden fields are dropped and dates are written as
 * ISO strings.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @template S The schema of what the view renders.
 * @param schema The schema of what the view renders.
 * @example
 * ```ts
 * export class PostView extends View(PostResource) {
 * 	public static override render(post: PostModel): ViewOutput<typeof PostResource> {
 * 		return { id: post.id, title: post.title, publishedAt: post.publishedAt };
 * 	}
 * }
 *
 * @Http.get('/', { response: PostView.page })
 * public list(@Http.query(Listing.schema(PostListing)) query: Listing.Params<typeof PostListing>) {
 * 	return this.posts.list(Listing.parse(PostListing, query));
 * }
 * ```
 */
export const View = <S extends TSchema>(schema: S) => {
	abstract class V {
		/** The schema of what the view renders. */
		public static readonly schema: S = schema;

		/**
		 * Renders one input. Every view defines it.
		 * @param input What the route's handler returns.
		 */
		public static render(input: unknown): ViewOutput<S> {
			void input;
			throw new ViewNotRenderableError(this.name);
		}

		/**
		 * Renders each input of a list, in order.
		 * @param inputs The inputs.
		 */
		public static renderAll<T extends { render(input: never): unknown }>(
			this: T,
			inputs: readonly ViewInput<T>[]
		): ReturnType<T['render']>[] {
			const render = this.render as (input: unknown) => ReturnType<T['render']>;
			return inputs.map((input) => render.call(this, input));
		}

		/**
		 * Renders the items of a page, and keeps its cursor, or its page and total, as they are.
		 * @param page The page.
		 */
		public static renderPage<
			T extends { render(input: never): unknown },
			P extends { data: readonly ViewInput<T>[] }
		>(this: T, page: P): Omit<P, 'data'> & { data: ReturnType<T['render']>[] } {
			const render = this.render as (input: unknown) => ReturnType<T['render']>;
			return withItems(
				page,
				page.data.map((input) => render.call(this, input))
			) as unknown as Omit<P, 'data'> & { data: ReturnType<T['render']>[] };
		}

		/** The response of a route that renders a list with this view. */
		public static get list(): ViewResponse<typeof V> {
			return { [VIEW_RESPONSE]: true, view: this, kind: 'list' };
		}

		/** The response of a route that renders a page with this view. */
		public static get page(): ViewResponse<typeof V> {
			return { [VIEW_RESPONSE]: true, view: this, kind: 'page' };
		}
	}

	Object.defineProperty(V, VIEW, { value: true });
	Object.defineProperty(V.render, BASE_RENDER, { value: true });

	return V;
};

/**
 * Helpers of the routes that answer with views.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export namespace Views {
	/** Whether a value is a view class. */
	export const isView = (value: unknown): value is ViewClass =>
		typeof value === 'function' && (value as unknown as Record<symbol, unknown>)[VIEW] === true;

	/** Whether a value is a response described by `View.list` or `View.page`. */
	export const isResponse = (value: unknown): value is ViewResponse =>
		typeof value === 'object' &&
		value !== null &&
		(value as Record<symbol, unknown>)[VIEW_RESPONSE] === true;

	/**
	 * The view and kind of a route's `response`, when it names a view.
	 * @param response The route's `response` option.
	 */
	export const of = (response: unknown): { view: ViewClass; kind: ViewKind } | undefined => {
		if (isView(response)) return { view: response, kind: 'one' };
		if (isResponse(response)) return { view: response.view, kind: response.kind };
		return undefined;
	};

	/**
	 * The pagination of a route's pages, read from its query schema: offset when it has a `page`
	 * parameter, cursor when it has a `cursor` parameter, and `undefined` otherwise, when the route
	 * answers pages of either.
	 * @param query The query schema of the route.
	 */
	export const paginationOf = (query: TSchema | undefined): ViewPagination | undefined => {
		const properties = (query as { properties?: Record<string, unknown> } | undefined)?.properties;
		if (properties?.page !== undefined) return 'offset';
		if (properties?.cursor !== undefined) return 'cursor';
		return undefined;
	};

	/**
	 * The response schema of a route rendered by a view.
	 * @param view The view class.
	 * @param kind One item, a list or a page.
	 * @param pagination The pagination of a page.
	 */
	export const schemaOf = (
		view: ViewClass,
		kind: ViewKind,
		pagination?: ViewPagination
	): TSchema =>
		kind === 'one'
			? view.schema
			: kind === 'list'
				? t.Array(view.schema)
				: pagination
					? pageResponseSchema(view.schema, pagination)
					: t.Union([
							pageResponseSchema(view.schema, 'cursor'),
							pageResponseSchema(view.schema, 'offset')
						]);

	/**
	 * Whether a view class defines its own `render` method.
	 * @param view The view class.
	 */
	export const isRenderable = (view: ViewClass): boolean =>
		(view.render as unknown as Record<symbol, unknown>)[BASE_RENDER] !== true;

	/**
	 * Renders what a handler returned with a view.
	 * @param view The view class.
	 * @param kind One item, a list or a page.
	 * @param value What the handler returned.
	 * @param pagination The pagination of a page: either when the route's query gives none.
	 * @throws {ViewInputError} When the value is not a list, or a page of the pagination, a list or
	 * a page route expects.
	 */
	export const render = (
		view: ViewClass,
		kind: ViewKind,
		value: unknown,
		pagination?: ViewPagination
	): unknown => {
		if (kind === 'list') {
			if (!Array.isArray(value)) throw new ViewInputError(view.name, 'a list');
			return view.renderAll(value as never[]);
		}
		if (kind === 'page') {
			const page = value as Record<string, unknown> | null;
			const actual =
				page && Array.isArray(page.data)
					? 'nextCursor' in page
						? 'cursor'
						: 'total' in page
							? 'offset'
							: undefined
					: undefined;
			if (!actual || (pagination && actual !== pagination)) {
				throw new ViewInputError(view.name, `a ${pagination ?? 'cursor or offset'} page`);
			}
			return view.renderPage(value as never);
		}
		return view.render(value as never);
	};
}
