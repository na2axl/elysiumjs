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

import type { ProblemValidationError, TObject, TSchema } from '@elysiumjs/core';
import type { ModelClass } from './interfaces';

import { DomainError } from '@elysiumjs/core';
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
export type QueryFilterSpec = {
	/** The operators the field accepts. The first one is used by `filter[field]=value`. */
	operators: FilterOperator[];
	/** The type of the values. Read from the model by {@link Query.define}; `string` otherwise. */
	type?: QueryFieldType;
	/** The model property behind the field, when it has another name. */
	column?: string;
};

/**
 * What clients may filter and sort by, and how many rows a page holds.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type QuerySpec = {
	/** The filterable fields, with their operators. */
	filters?: Record<string, QueryFilterSpec | FilterOperator[]>;
	/** The sortable fields. Sortable columns should not be nullable, for cursor pagination. */
	sort?: string[];
	/** The sort used when the query sets none, such as `-createdAt`. */
	defaultSort?: string;
	/** The page size: the default, and the largest a client may ask for. */
	limit?: { default?: number; max?: number };
	/** The model property that identifies rows, the tiebreaker of every sort. Defaults to `id`. */
	key?: string;
	/** The types of the model's properties, set by {@link Query.define}. */
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

/**
 * A query string, validated against a {@link QuerySpec}, that repositories run.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type ParsedQuery = {
	filters: ParsedFilter[];
	/** The sort keys, ending with the row key as the tiebreaker. */
	sort: ParsedSort[];
	/** The values of the sort keys of the last row of the previous page. */
	after?: unknown[];
	limit: number;
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

const DEFAULT_LIMIT = 20;
const DEFAULT_MAX_LIMIT = 100;

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

const normalizeFilter = (spec: QueryFilterSpec | FilterOperator[]): QueryFilterSpec =>
	Array.isArray(spec) ? { operators: spec } : spec;

export namespace Query {
	/**
	 * Builds a query spec for a model: the types of the filtered and sorted fields are read from
	 * the model's select schema.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param model The model class.
	 * @param spec The filters, sorts and page size.
	 * @example
	 * ```ts
	 * const PostQuery = Query.define(Post, {
	 *   filters: { status: ['eq', 'in'], createdAt: ['gte', 'lte'], title: ['contains'] },
	 *   sort: ['createdAt', 'title'],
	 *   defaultSort: '-createdAt'
	 * });
	 * ```
	 */
	export const define = <TModel extends ModelClass>(
		model: TModel,
		spec: Omit<QuerySpec, 'types'>
	): QuerySpec => {
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
	 * The query schema of a spec, for `@Http.query()`: it documents the filters, `sort`, `cursor`,
	 * `limit` and `fields` parameters in OpenAPI.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param spec The query spec.
	 */
	export const schema = (spec: QuerySpec): TObject => {
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
		properties.cursor = t.Optional(t.String({ description: 'The cursor of the next page.' }));
		properties.limit = t.Optional(
			t.String({
				description: `Rows per page, up to ${spec.limit?.max ?? DEFAULT_MAX_LIMIT}.`
			})
		);
		properties.fields = t.Optional(t.String({ description: 'Comma-separated fields to return.' }));
		return t.Object(properties, { additionalProperties: true });
	};

	/**
	 * Validates a query string against a spec.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param spec The query spec.
	 * @param query The query, as Elysia parses it (`filter[status]` keys stay flat).
	 * @returns The parsed query, for a repository's `list()`.
	 * @throws {DomainError} A 400 problem whose `errors` name every invalid parameter.
	 */
	export const parse = (spec: QuerySpec, query: Record<string, unknown> = {}): ParsedQuery => {
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
			throw DomainError.badRequest('The query is invalid.', { errors });
		}
		return { filters, sort, after, limit };
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
		return { data, nextCursor: more ? cursorAfter(query, data.at(-1)!) : null };
	};

	/**
	 * The response schema of a page of resources.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param item The schema of one row.
	 */
	export const pageSchema = <S extends TSchema>(item: S) =>
		t.Object({ data: t.Array(item), nextCursor: t.Nullable(t.String()) });
}
