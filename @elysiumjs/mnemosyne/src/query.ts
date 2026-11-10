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

import type { ProblemValidationError, TObject, TOptional, TSchema, TString } from '@elysiumjs/core';
import type { ModelClass } from './interfaces';

import { BadRequestError } from '@elysiumjs/core';
import { t } from 'elysia';

/**
 * A filter operator of the query DSL.
 *
 * - `eq`, `ne`, `gt`, `gte`, `lt`, `lte`: comparisons.
 * - `in`: one of a comma-separated list.
 * - `contains`, `startsWith`: case-insensitive text matches.
 * - `isNull`: `true` or `false`.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type FilterOperator =
	'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'contains' | 'startsWith' | 'isNull';

/**
 * The type of a filtered or sorted field, which decides how its query values are read.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type QueryFieldType = 'string' | 'number' | 'boolean' | 'date' | 'uuid';

/**
 * A filterable field.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type QueryFilterSpec<TOperator extends FilterOperator = FilterOperator> = {
	/** The operators the field accepts. The first one is used by `filter[field]=value`. */
	operators: readonly TOperator[];
	/** The type of the values. Read from the model by {@link Listing.define}; `string` otherwise. */
	type?: QueryFieldType;
	/** The model property behind the field, when it has another name. */
	column?: string;
};

/**
 * The filterable fields of a spec, each with its operators or its {@link QueryFilterSpec}.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type QueryFilters = Record<string, QueryFilterSpec | readonly FilterOperator[]>;

/**
 * How a listing pages its rows.
 *
 * - `cursor`: `cursor` points after the last row of the previous page. Pages stay stable while rows
 *   are added, and each page costs the same: the choice for feeds and long listings.
 * - `offset`: `page` numbers the pages from 1, and each page tells the total. The choice for
 *   tables that jump to a page; deep pages cost more, and added rows shift them.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type QueryPagination = 'cursor' | 'offset';

/**
 * What clients may filter and sort by, how a page is found, and how many rows it holds.
 *
 * The type parameters keep the names of the filters and the sortable fields and the pagination,
 * so that {@link Listing.Params} and {@link Listing.schema} can type the query string.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type QuerySpec<
	TFilters extends QueryFilters = QueryFilters,
	TSort extends string = string,
	TPagination extends QueryPagination = QueryPagination
> = {
	/** How pages are found: `cursor` (the default) or `offset`. */
	pagination?: TPagination;
	/** The filterable fields, with their operators. */
	filters?: TFilters;
	/** The sortable fields. Sortable columns should not be nullable, for cursor pagination. */
	sort?: readonly TSort[];
	/** The sort used when the query sets none, such as `-createdAt`. */
	defaultSort?: string;
	/** The page size: the default, and the largest a client may ask for. */
	limit?: { default?: number; max?: number };
	/** The model property that identifies rows, the tiebreaker of every sort. Defaults to `id`. */
	key?: string;
	/** The types of the model's properties, set by {@link Listing.define}. */
	types?: Record<string, QueryFieldType>;
	/** The property names of the model, for sortable fields that map to another column. */
	columns?: Record<string, string>;
};

/**
 * One filter of a parsed query.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type ParsedFilter = {
	field: string;
	column: string;
	operator: FilterOperator;
	value: unknown;
};

/**
 * One sort key of a parsed query.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type ParsedSort = { field: string; column: string; direction: 'asc' | 'desc' };

/** The members of every parsed query. */
type ParsedQueryBase = {
	filters: ParsedFilter[];
	/** The sort keys, ending with the row key as the tiebreaker. */
	sort: ParsedSort[];
	limit: number;
};

/**
 * A query string, validated against a {@link QuerySpec}, that repositories run: with `after` for
 * cursor pagination, or `page` for offset pagination.
 * @author Axel Nana <axel.nana@workbud.com>
 * @template P The pagination of the spec.
 */
export type ParsedQuery<P extends QueryPagination = QueryPagination> = P extends 'offset'
	? ParsedQueryBase & {
			/** The page, from 1. */
			page: number;
			after?: undefined;
		}
	: ParsedQueryBase & {
			/** The values of the sort keys of the last row of the previous page. */
			after?: unknown[];
			page?: undefined;
		};

/**
 * A page of rows from cursor pagination.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type CursorPage<T> = {
	data: T[];
	/** The cursor of the next page, or `null` on the last page. */
	nextCursor: string | null;
};

/**
 * A page of rows from offset pagination.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type OffsetPage<T> = {
	data: T[];
	/** The page, from 1. */
	page: number;
	/** The rows per page. */
	limit: number;
	/** The rows matching the filters, on every page. */
	total: number;
};

/**
 * A page of rows, from either pagination.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type Page<T> = CursorPage<T> | OffsetPage<T>;

/**
 * The pagination of a spec.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type PaginationOf<TSpec> = TSpec extends QuerySpec<any, any, infer P> ? P : QueryPagination;

/** The operators of one filter of a spec. */
type OperatorsOf<TFilter> = TFilter extends readonly (infer TOperator)[]
	? TOperator
	: TFilter extends { operators: readonly (infer TOperator)[] }
		? TOperator
		: never;

/** The filter keys of a spec: `filter[field]` and `filter[field][operator]`. */
type FilterKeysOf<TFilters> = {
	[K in keyof TFilters & string]:
		`filter[${K}]` | `filter[${K}][${OperatorsOf<TFilters[K]> & string}]`;
}[keyof TFilters & string];

/**
 * The parameter names of the query string of a spec.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type QueryParamKeys<TSpec> =
	TSpec extends QuerySpec<infer TFilters, infer TSort, infer TPagination>
		? | FilterKeysOf<TFilters>
			| ([TSort] extends [never] ? never : 'sort')
			| (TPagination extends 'offset' ? 'page' : 'cursor')
			| 'limit'
			| 'fields'
		: never;

/**
 * The query string of a spec, as Elysia parses it: every parameter is an optional string.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type QueryParams<TSpec> = { [K in QueryParamKeys<TSpec>]?: string };

/**
 * The properties of the query schema of a spec.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type QuerySchemaProperties<TSpec> = { [K in QueryParamKeys<TSpec>]: TOptional<TString> };

const DEFAULT_LIMIT = 20;
const DEFAULT_MAX_LIMIT = 100;

/** The JSON Schema keyword that marks the schema of a page, with its pagination. */
const PAGE_KEYWORD = 'x-elysium-page';

/** The symbol that marks a page built by {@link Listing.page} or {@link Listing.offsetPage}. */
const PAGE = Symbol.for('elysium:mnemosyne:page');

/** Marks a page with its pagination, without adding an enumerable member. */
const brand = <P extends object>(page: P, pagination: QueryPagination): P =>
	Object.defineProperty(page, PAGE, { value: pagination, enumerable: false });

const FILTER_KEY = /^filter\[([^\]]+)\](?:\[([^\]]+)\])?$/;

const toBase64Url = (text: string): string =>
	btoa(String.fromCharCode(...new TextEncoder().encode(text)))
		.replaceAll('+', '-')
		.replaceAll('/', '_')
		.replace(/=+$/, '');

const fromBase64Url = (text: string): string => {
	const base64 = text.replaceAll('-', '+').replaceAll('_', '/');
	const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
	return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Reads one query value as the field type, or returns an error message. */
const readValue = (type: QueryFieldType, raw: string): { value: unknown } | { error: string } => {
	switch (type) {
		case 'number': {
			const value = Number(raw);
			return raw.trim() !== '' && Number.isFinite(value)
				? { value }
				: { error: 'must be a number' };
		}
		case 'boolean':
			return raw === 'true' || raw === 'false'
				? { value: raw === 'true' }
				: { error: 'must be true or false' };
		case 'date': {
			const value = new Date(raw);
			return Number.isNaN(value.getTime()) ? { error: 'must be a date' } : { value };
		}
		case 'uuid':
			return UUID.test(raw) ? { value: raw } : { error: 'must be a UUID' };
		default:
			return { value: raw };
	}
};

/** The query type of a property of a model's select schema. */
const typeOfSchema = (schema: {
	type?: unknown;
	format?: unknown;
	anyOf?: { type?: unknown }[];
}): QueryFieldType => {
	const node = schema.anyOf?.find((branch) => branch.type !== 'null') ?? schema;
	const { type, format } = node as { type?: unknown; format?: unknown };
	if (type === 'number' || type === 'integer' || type === 'bigint') return 'number';
	if (type === 'boolean') return 'boolean';
	if (format === 'date' || format === 'date-time') return 'date';
	if (format === 'uuid') return 'uuid';
	return 'string';
};

const normalizeFilter = (spec: QueryFilterSpec | readonly FilterOperator[]): QueryFilterSpec =>
	'operators' in spec ? spec : { operators: spec };

export namespace Listing {
	/**
	 * Builds a query spec for a model: the types of the filtered and sorted fields are read from
	 * the model's select schema.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param model The model class.
	 * @param spec The filters, sorts and page size.
	 * @example
	 * ```ts
	 * const PostQuery = Listing.define(Post, {
	 *   filters: { status: ['eq', 'in'], createdAt: ['gte', 'lte'], title: ['contains'] },
	 *   sort: ['createdAt', 'title'],
	 *   defaultSort: '-createdAt'
	 * });
	 * ```
	 */
	export const define = <
		TModel extends ModelClass,
		const TFilters extends QueryFilters = {},
		const TSort extends string = never,
		const TPagination extends QueryPagination = 'cursor'
	>(
		model: TModel,
		spec: Omit<QuerySpec<TFilters, TSort, TPagination>, 'types'>
	): QuerySpec<TFilters, TSort, TPagination> => {
		const properties =
			(model.selectSchema as unknown as { properties?: Record<string, object> }).properties ?? {};
		const types: Record<string, QueryFieldType> = {};
		for (const [name, schema] of Object.entries(properties)) types[name] = typeOfSchema(schema);
		return { ...spec, types };
	};

	/** The type of a field: set on its filter, read from the model, or `string`. */
	const typeOf = (spec: QuerySpec, field: string, column: string): QueryFieldType => {
		const filter = spec.filters?.[field];
		return (
			(filter && normalizeFilter(filter).type) ??
			spec.types?.[column] ??
			spec.types?.[field] ??
			'string'
		);
	};

	const columnOf = (spec: QuerySpec, field: string): string => {
		const filter = spec.filters?.[field];
		return (filter && normalizeFilter(filter).column) ?? spec.columns?.[field] ?? field;
	};

	/**
	 * The query string of a spec, for the parameter that `@Http.query()` decorates.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @example
	 * ```ts
	 * @Http.get('/posts')
	 * list(@Http.query(Listing.schema(PostQuery)) query: Listing.Params<typeof PostQuery>) {
	 *   return this.posts.list(Listing.parse(PostQuery, query));
	 * }
	 * ```
	 */
	export type Params<TSpec> = QueryParams<TSpec>;

	/**
	 * The query schema of a spec, for `@Http.query()`: it documents the filters, `sort`, `cursor`
	 * (or `page` for offset pagination), `limit` and `fields` parameters in OpenAPI. Its static type is {@link Listing.Params}, and other
	 * parameters are let through.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param spec The query spec.
	 */
	export const schema = <TSpec extends QuerySpec>(
		spec: TSpec
	): TObject<QuerySchemaProperties<TSpec>> => {
		const properties: Record<string, TSchema> = {};
		for (const [field, raw] of Object.entries(spec.filters ?? {})) {
			const filter = normalizeFilter(raw);
			properties[`filter[${field}]`] = t.Optional(
				t.String({ description: `Filters ${field} (${filter.operators[0]}).` })
			);
			for (const operator of filter.operators) {
				properties[`filter[${field}][${operator}]`] = t.Optional(
					t.String({ description: `Filters ${field} with ${operator}.` })
				);
			}
		}
		if (spec.sort?.length) {
			properties.sort = t.Optional(
				t.String({
					description: `Comma-separated sort fields, "-" for descending: ${spec.sort.join(', ')}.`
				})
			);
		}
		if (spec.pagination === 'offset') {
			properties.page = t.Optional(t.String({ description: 'The page, from 1.' }));
		} else {
			properties.cursor = t.Optional(t.String({ description: 'The cursor of the next page.' }));
		}
		properties.limit = t.Optional(
			t.String({
				description: `Rows per page, up to ${spec.limit?.max ?? DEFAULT_MAX_LIMIT}.`
			})
		);
		properties.fields = t.Optional(t.String({ description: 'Comma-separated fields to return.' }));
		return t.Object(properties, { additionalProperties: true }) as unknown as TObject<
			QuerySchemaProperties<TSpec>
		>;
	};

	/**
	 * Validates a query string against a spec.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param spec The query spec.
	 * @param query The query, as Elysia parses it (`filter[status]` keys stay flat).
	 * @returns The parsed query, for a repository's `list()`.
	 * @throws {BadRequestError} A 400 problem whose `errors` name every invalid parameter.
	 */
	export const parse = <TSpec extends QuerySpec>(
		spec: TSpec,
		query: Record<string, unknown> = {}
	): ParsedQuery<PaginationOf<TSpec>> => {
		const errors: ProblemValidationError[] = [];
		const fail = (parameter: string, message: string, code: string) =>
			errors.push({ pointer: `/query/${parameter.replaceAll('/', '~1')}`, message, code });

		const filters: ParsedFilter[] = [];
		for (const [key, raw] of Object.entries(query)) {
			const match = FILTER_KEY.exec(key);
			if (!match) continue;
			const [, field, named] = match as unknown as [string, string, string | undefined];
			const filterSpec = spec.filters?.[field];
			if (!filterSpec) {
				fail(key, `cannot filter by "${field}"`, 'filter');
				continue;
			}
			const { operators } = normalizeFilter(filterSpec);
			const operator = (named ?? operators[0]) as FilterOperator;
			if (!operators.includes(operator)) {
				fail(key, `"${operator}" is not allowed on "${field}"`, 'operator');
				continue;
			}
			const column = columnOf(spec, field);
			const type = typeOf(spec, field, column);
			const text = String(Array.isArray(raw) ? raw.at(-1) : raw);

			if (operator === 'isNull') {
				const read = readValue('boolean', text);
				if ('error' in read) fail(key, read.error, 'type');
				else filters.push({ field, column, operator, value: read.value });
				continue;
			}
			if (operator === 'in') {
				const values: unknown[] = [];
				for (const part of text.split(',')) {
					const read = readValue(type, part.trim());
					if ('error' in read) fail(key, `each value ${read.error}`, 'type');
					else values.push(read.value);
				}
				if (values.length > 0 && values.length === text.split(',').length) {
					filters.push({ field, column, operator, value: values });
				}
				continue;
			}
			const read = readValue(
				operator === 'contains' || operator === 'startsWith' ? 'string' : type,
				text
			);
			if ('error' in read) fail(key, read.error, 'type');
			else filters.push({ field, column, operator, value: read.value });
		}

		const key = spec.key ?? 'id';
		const sort: ParsedSort[] = [];
		const rawSort =
			typeof query.sort === 'string' && query.sort !== '' ? query.sort : spec.defaultSort;
		for (const part of (rawSort ?? '')
			.split(',')
			.map((item) => item.trim())
			.filter(Boolean)) {
			const direction = part.startsWith('-') ? 'desc' : 'asc';
			const field = part.replace(/^[-+]/, '');
			if (!spec.sort?.includes(field)) {
				fail('sort', `cannot sort by "${field}"`, 'sort');
				continue;
			}
			sort.push({ field, column: columnOf(spec, field), direction });
		}
		if (!sort.some((item) => item.column === key)) {
			sort.push({ field: key, column: key, direction: sort.at(-1)?.direction ?? 'asc' });
		}

		const max = spec.limit?.max ?? DEFAULT_MAX_LIMIT;
		let limit = spec.limit?.default ?? DEFAULT_LIMIT;
		if (query.limit !== undefined && query.limit !== '') {
			const value = Number(query.limit);
			if (!Number.isInteger(value) || value < 1 || value > max) {
				fail('limit', `must be a whole number from 1 to ${max}`, 'limit');
			} else {
				limit = value;
			}
		}

		if (spec.pagination === 'offset') {
			let page = 1;
			if (query.page !== undefined && query.page !== '') {
				const value = Number(query.page);
				if (!Number.isInteger(value) || value < 1)
					fail('page', 'must be a whole number from 1', 'page');
				else page = value;
			}
			if (errors.length > 0) throw new BadRequestError('The query is invalid.', { errors });
			return { filters, sort, limit, page } as ParsedQuery<PaginationOf<TSpec>>;
		}

		let after: unknown[] | undefined;
		if (typeof query.cursor === 'string' && query.cursor !== '') {
			const decoded = decodeCursor(query.cursor, sort.length);
			// Each value must read as the type of its sort key, so that a crafted cursor answers a
			// 400 instead of reaching the database.
			const values = decoded?.map((value, index) => {
				if (value === null) return { value: null };
				if (!['string', 'number', 'boolean'].includes(typeof value)) return { error: 'bad' };
				const { field, column } = sort[index]!;
				return readValue(typeOf(spec, field, column), String(value));
			});
			if (!values || values.some((read) => 'error' in read)) {
				fail('cursor', 'is not a cursor of this listing', 'cursor');
			} else {
				after = values.map((read) => (read as { value: unknown }).value);
			}
		}

		if (errors.length > 0) {
			throw new BadRequestError('The query is invalid.', { errors });
		}
		return { filters, sort, after, limit } as ParsedQuery<PaginationOf<TSpec>>;
	};

	/**
	 * Builds the cursor that points after a row.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param query The parsed query, for its sort keys.
	 * @param row The last row of a page.
	 */
	export const cursorAfter = (query: ParsedQuery, row: Record<string, unknown>): string =>
		toBase64Url(
			JSON.stringify(
				query.sort.map(({ column }) => {
					const value = row[column];
					return value instanceof Date ? value.toISOString() : value;
				})
			)
		);

	/** Reads a cursor, or returns `undefined` when it is not one for `length` sort keys. */
	const decodeCursor = (cursor: string, length: number): unknown[] | undefined => {
		try {
			const values = JSON.parse(fromBase64Url(cursor));
			return Array.isArray(values) && values.length === length ? values : undefined;
		} catch {
			return undefined;
		}
	};

	/**
	 * Builds a page from rows fetched with one more row than the limit: the extra row only tells
	 * that a next page exists.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param query The parsed query.
	 * @param rows Up to `limit + 1` rows.
	 */
	export const page = <T extends Record<string, unknown>>(
		query: ParsedQuery,
		rows: T[]
	): CursorPage<T> => {
		const data = rows.slice(0, query.limit);
		const more = rows.length > query.limit;
		return brand({ data, nextCursor: more ? cursorAfter(query, data.at(-1)!) : null }, 'cursor');
	};

	/**
	 * Builds a page from the rows of an offset query and the count of the rows its filters match.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param query The parsed query, with its page.
	 * @param rows The rows of the page.
	 * @param total The rows matching the filters.
	 */
	export const offsetPage = <T>(
		query: ParsedQuery<'offset'>,
		rows: T[],
		total: number
	): OffsetPage<T> => brand({ data: rows, page: query.page, limit: query.limit, total }, 'offset');

	/**
	 * Checks whether a value is a page built by {@link page} or {@link offsetPage}, such as the
	 * result of a handler, so that an interceptor can render it.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param value The value.
	 */
	export const isPage = (value: unknown): value is Page<unknown> =>
		typeof value === 'object' && value !== null && PAGE in value;

	/**
	 * The pagination of a page built by {@link page} or {@link offsetPage}.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param page The page.
	 */
	export const paginationOf = (page: Page<unknown>): QueryPagination =>
		(page as unknown as Record<symbol, QueryPagination>)[PAGE] ??
		('total' in page ? 'offset' : 'cursor');

	/**
	 * Maps the rows of a page, such as models to resources, and keeps it a page.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param page The page.
	 * @param map Maps one row.
	 */
	export function mapPage<T, U>(page: CursorPage<T>, map: (row: T) => U): CursorPage<U>;
	export function mapPage<T, U>(page: OffsetPage<T>, map: (row: T) => U): OffsetPage<U>;
	export function mapPage<T, U>(page: Page<T>, map: (row: T) => U): Page<U>;
	export function mapPage<T, U>(page: Page<T>, map: (row: T) => U): Page<U> {
		return brand({ ...page, data: page.data.map(map) }, paginationOf(page));
	}

	/**
	 * Keeps the rows of a page that pass a predicate, such as the rows the caller may see. The
	 * cursor, or the page and the total, stay those of the page as listed.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param page The page.
	 * @param keep Whether a row stays.
	 */
	export function filterPage<T, S extends T>(
		page: CursorPage<T>,
		keep: (row: T) => row is S
	): CursorPage<S>;
	export function filterPage<T, S extends T>(
		page: OffsetPage<T>,
		keep: (row: T) => row is S
	): OffsetPage<S>;
	export function filterPage<T, S extends T>(page: Page<T>, keep: (row: T) => row is S): Page<S>;
	export function filterPage<T>(page: CursorPage<T>, keep: (row: T) => boolean): CursorPage<T>;
	export function filterPage<T>(page: OffsetPage<T>, keep: (row: T) => boolean): OffsetPage<T>;
	export function filterPage<T>(page: Page<T>, keep: (row: T) => boolean): Page<T>;
	export function filterPage<T>(page: Page<T>, keep: (row: T) => boolean): Page<T> {
		return brand({ ...page, data: page.data.filter(keep) }, paginationOf(page));
	}

	/**
	 * The response schema of a page of resources from cursor pagination.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param item The schema of one row.
	 */
	export const pageSchema = <S extends TSchema>(item: S) =>
		t.Object(
			{ data: t.Array(item), nextCursor: t.Nullable(t.String()) },
			{ [PAGE_KEYWORD]: 'cursor' }
		);

	/**
	 * The response schema of a page of resources from offset pagination.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param item The schema of one row.
	 */
	export const offsetPageSchema = <S extends TSchema>(item: S) =>
		t.Object(
			{
				data: t.Array(item),
				page: t.Integer({ minimum: 1 }),
				limit: t.Integer({ minimum: 1 }),
				total: t.Integer({ minimum: 0 })
			},
			{ [PAGE_KEYWORD]: 'offset' }
		);

	/**
	 * The pagination of a schema made by {@link pageSchema} or {@link offsetPageSchema}, or
	 * `undefined` for any other schema, so that an interceptor can describe what it renders.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param schema The schema.
	 */
	export const pageSchemaPagination = (schema: TSchema): QueryPagination | undefined => {
		const pagination = (schema as Record<string, unknown>)[PAGE_KEYWORD];
		return pagination === 'cursor' || pagination === 'offset' ? pagination : undefined;
	};

	/**
	 * Checks whether a schema is the schema of a page, made by {@link pageSchema} or
	 * {@link offsetPageSchema}.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param schema The schema.
	 */
	export const isPageSchema = (schema: TSchema): boolean =>
		pageSchemaPagination(schema) !== undefined;

	/**
	 * The schema of one row of a page schema.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param schema A schema made by {@link pageSchema} or {@link offsetPageSchema}.
	 */
	export const itemSchemaOf = (schema: TSchema): TSchema | undefined =>
		(schema as { properties?: { data?: { items?: TSchema } } }).properties?.data?.items;
}

/**
 * An alias of {@link Listing}.
 * @deprecated Use `Listing`: `Query` is also the name of the queries of `@elysiumjs/moirai`.
 */
export const Query = Listing;

/**
 * An alias of {@link Listing}.
 * @deprecated Use `Listing`.
 */
export namespace Query {
	/** @deprecated Use `Listing.Params`. */
	export type Params<TSpec> = Listing.Params<TSpec>;
}
