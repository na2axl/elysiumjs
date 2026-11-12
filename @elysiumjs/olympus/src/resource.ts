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

import type { TSchema } from 'typebox';

import { ElysiaStatus } from 'elysia';

import { BadRequestError } from './problem';

const HIDDEN = Symbol.for('elysium:Hidden');

/** A schema as the serializer reads it: JSON Schema keywords. */
type SchemaNode = {
	type?: string | string[];
	format?: string;
	properties?: Record<string, SchemaNode>;
	required?: string[];
	additionalProperties?: unknown;
	items?: SchemaNode;
	anyOf?: SchemaNode[];
	oneOf?: SchemaNode[];
	[HIDDEN]?: true;
};

/** Copies a schema with its non-enumerable TypeBox keys (`~kind`), adding or removing some. */
const cloneSchema = <S extends object>(
	schema: S,
	extra: Record<PropertyKey, unknown> = {},
	drop: PropertyKey[] = []
): S => {
	const descriptors = Object.getOwnPropertyDescriptors(schema) as Record<
		PropertyKey,
		PropertyDescriptor
	>;
	for (const key of drop) delete descriptors[key];
	const clone = Object.defineProperties({}, descriptors) as Record<PropertyKey, unknown>;
	for (const key of Reflect.ownKeys(extra)) {
		Object.defineProperty(clone, key, {
			value: extra[key],
			enumerable: typeof key === 'string',
			writable: true,
			configurable: true
		});
	}
	return clone as S;
};

const isObjectSchema = (schema: SchemaNode): boolean =>
	schema.type === 'object' && typeof schema.properties === 'object';

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
	if (typeof value !== 'object' || value === null) return false;
	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
};

/**
 * The response schemas of a route: one schema, or one per status code.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type ResponseSchemas = TSchema | Record<number, TSchema>;

/** Whether a `response` option maps status codes to schemas. */
export const isStatusMap = (response: ResponseSchemas): response is Record<number, TSchema> => {
	const keys = Object.keys(response);
	return keys.length > 0 && keys.every((key) => /^\d{3}$/.test(key));
};

export namespace Resource {
	/**
	 * Marks a field of a response schema as hidden: it is dropped from responses and from the
	 * OpenAPI document, even when the handler returns it.
	 * @author Axel Nana <ax.lnana@outlook.com>
	 * @param schema The schema of the field.
	 * @example
	 * ```ts
	 * const UserResource = t.Object({ id: t.String(), passwordHash: Resource.hidden(t.String()) });
	 * ```
	 */
	export const hidden = <S extends TSchema>(schema: S): S =>
		cloneSchema(schema, { [HIDDEN]: true });

	/** Whether a schema was marked with {@link hidden}. */
	export const isHidden = (schema: unknown): boolean =>
		typeof schema === 'object' && schema !== null && HIDDEN in schema;

	/**
	 * The schema clients see: hidden fields removed, and codecs replaced by the schema of their
	 * encoded value, since responses are serialized before they are validated.
	 * @author Axel Nana <ax.lnana@outlook.com>
	 * @param schema The response schema.
	 */
	export const project = <S extends TSchema>(schema: S): S =>
		projectNode(schema as SchemaNode) as S;

	/**
	 * Projects every schema of a route's `response` option.
	 * @author Axel Nana <ax.lnana@outlook.com>
	 * @param response The `response` option: one schema, or one per status code.
	 */
	export const projectResponse = (response: ResponseSchemas): ResponseSchemas => {
		if (!isStatusMap(response)) return project(response);
		const projected: Record<number, TSchema> = {};
		for (const [status, schema] of Object.entries(response)) {
			projected[Number(status)] = project(schema);
		}
		return projected;
	};

	/**
	 * The schema of the successful response: the schema itself, or the 200 (else the first 2xx)
	 * one of a status map.
	 * @author Axel Nana <ax.lnana@outlook.com>
	 * @param response The `response` option of a route.
	 */
	export const successSchema = (response: ResponseSchemas): TSchema | undefined => {
		if (!isStatusMap(response)) return response;
		if (response[200]) return response[200];
		const status = Object.keys(response)
			.map(Number)
			.sort((a, b) => a - b)
			.find((code) => code >= 200 && code < 300);
		return status === undefined ? undefined : response[status];
	};

	/**
	 * Options of {@link serialize}.
	 * @author Axel Nana <ax.lnana@outlook.com>
	 */
	export type SerializeOptions = {
		/**
		 * The fields to keep, from a sparse fieldset (`?fields=id,title`). Applies to a top-level
		 * object, to each item of a top-level array, and to the items of a `data` array.
		 */
		fields?: string[];
	};

	/**
	 * Turns a handler result into the body its response schema describes:
	 *
	 * - fields the schema does not declare are stripped, and hidden fields are dropped;
	 * - a `Date` becomes an ISO string (`YYYY-MM-DD` when the schema's format is `date`), and an
	 *   object with a `toJSON()` method, such as a luxon `DateTime`, becomes what it returns;
	 * - `fields` keeps only the selected fields.
	 * @author Axel Nana <ax.lnana@outlook.com>
	 * @param schema The response schema.
	 * @param value The handler result.
	 * @param options The sparse fieldset.
	 * @throws {BadRequestError} A 400 problem when `fields` names a field the schema does not have.
	 */
	export const serialize = (
		schema: TSchema,
		value: unknown,
		options: SerializeOptions = {}
	): unknown => {
		const node = schema as SchemaNode;
		const fields = options.fields?.filter(Boolean);
		if (!fields?.length) return serializeNode(node, value);

		const target = fieldsTarget(node);
		if (!target) return serializeNode(node, value);
		const allowed = Object.keys(target.properties!).filter(
			(key) => !isHidden(target.properties![key])
		);
		const unknown = fields.filter((field) => !allowed.includes(field));
		if (unknown.length > 0) {
			throw new BadRequestError('The requested fields are not part of this resource.', {
				errors: unknown.map((field) => ({
					pointer: '/query/fields',
					message: `unknown field "${field}"`,
					code: 'fields'
				}))
			});
		}
		const selected = new Set(fields);
		const narrow = (object: SchemaNode): SchemaNode =>
			cloneSchema(object, {
				properties: Object.fromEntries(
					Object.entries(object.properties!).filter(([key]) => selected.has(key))
				),
				required: (object.required ?? []).filter((key) => selected.has(key))
			});
		return serializeNode(replaceTarget(node, target, narrow(target)), value);
	};
}

/** The object schema a sparse fieldset applies to: the object, the array items, or `data` items. */
const fieldsTarget = (schema: SchemaNode): SchemaNode | undefined => {
	if (schema.type === 'array' && schema.items && isObjectSchema(schema.items)) return schema.items;
	if (!isObjectSchema(schema)) return undefined;
	const data = schema.properties!.data;
	if (data?.type === 'array' && data.items && isObjectSchema(data.items)) return data.items;
	return schema;
};

/** Rebuilds `schema` with `target` (found by {@link fieldsTarget}) replaced. */
const replaceTarget = (schema: SchemaNode, target: SchemaNode, next: SchemaNode): SchemaNode => {
	if (schema === target) return next;
	if (schema.items === target) return cloneSchema(schema, { items: next });
	const data = schema.properties!.data!;
	return cloneSchema(schema, {
		properties: { ...schema.properties, data: cloneSchema(data, { items: next }) }
	});
};

const projectNode = (schema: SchemaNode): SchemaNode => {
	let node = '~codec' in schema ? cloneSchema(schema, {}, ['~codec']) : schema;
	if (isObjectSchema(node)) {
		const properties: Record<string, SchemaNode> = {};
		for (const [key, property] of Object.entries(node.properties!)) {
			if (!Resource.isHidden(property)) properties[key] = projectNode(property);
		}
		node = cloneSchema(node, {
			properties,
			...(node.required ? { required: node.required.filter((key) => key in properties) } : {})
		});
	}
	if (node.items) node = cloneSchema(node, { items: projectNode(node.items) });
	if (node.anyOf) node = cloneSchema(node, { anyOf: node.anyOf.map(projectNode) });
	if (node.oneOf) node = cloneSchema(node, { oneOf: node.oneOf.map(projectNode) });
	return node;
};

/** Picks the branch of a union that fits a value. */
/**
 * Whether an object value fits an object branch: it has every required property, and every
 * property the branch fixes to one value (a literal, such as a discriminator) has that value.
 */
const fitsObject = (branch: SchemaNode, value: Record<string, unknown>): boolean => {
	if (!(branch.required ?? []).every((key) => value[key] !== undefined)) return false;
	return Object.entries(branch.properties!).every(([key, property]) => {
		if (!('const' in property)) return true;
		return value[key] === undefined || value[key] === (property as { const: unknown }).const;
	});
};

/**
 * The object branch of a union that an object value belongs to: the first that it fits and that
 * keeps the most of its properties, else the first object branch.
 */
const objectBranchFor = (
	branches: SchemaNode[],
	value: Record<string, unknown>
): SchemaNode | undefined => {
	const objects = branches.filter(isObjectSchema);
	const keys = Object.keys(value).filter((key) => value[key] !== undefined);
	let best: SchemaNode | undefined;
	let kept = -1;
	for (const branch of objects) {
		if (!fitsObject(branch, value)) continue;
		const count = keys.filter((key) => key in branch.properties!).length;
		if (count > kept) {
			best = branch;
			kept = count;
		}
	}
	return best ?? objects[0];
};

const branchFor = (branches: SchemaNode[], value: unknown): SchemaNode | undefined => {
	if (value === null) return branches.find((branch) => branch.type === 'null');
	if (Array.isArray(value)) return branches.find((branch) => branch.type === 'array');
	if (typeof value === 'object') {
		return objectBranchFor(branches, value as Record<string, unknown>);
	}
	return branches.find((branch) => branch.type !== 'null');
};

const serializeNode = (schema: SchemaNode | undefined, value: unknown): unknown => {
	if (value instanceof Date) {
		return schema?.format === 'date' ? value.toISOString().slice(0, 10) : value.toISOString();
	}
	if (
		typeof value === 'object' &&
		value !== null &&
		!Array.isArray(value) &&
		!isPlainObject(value) &&
		typeof (value as { toJSON?: unknown }).toJSON === 'function'
	) {
		return serializeNode(schema, (value as { toJSON(): unknown }).toJSON());
	}
	if (!schema) return value;

	const union = schema.anyOf ?? schema.oneOf;
	if (union) return serializeNode(branchFor(union, value), value);

	if (Array.isArray(value)) {
		return schema.type === 'array' ? value.map((item) => serializeNode(schema.items, item)) : value;
	}

	if (isObjectSchema(schema) && typeof value === 'object' && value !== null) {
		const source = value as Record<string, unknown>;
		const result: Record<string, unknown> = {};
		for (const [key, property] of Object.entries(schema.properties!)) {
			if (Resource.isHidden(property) || source[key] === undefined) continue;
			result[key] = serializeNode(property, source[key]);
		}
		if (schema.additionalProperties !== undefined && schema.additionalProperties !== false) {
			const extra =
				typeof schema.additionalProperties === 'object'
					? (schema.additionalProperties as SchemaNode)
					: undefined;
			for (const [key, item] of Object.entries(source)) {
				if (!(key in schema.properties!) && item !== undefined) {
					result[key] = serializeNode(extra, item);
				}
			}
		}
		return result;
	}

	return value;
};

/**
 * Whether a handler result is a body to serialize, rather than a response the handler built
 * itself (a `Response`, a thrown or returned status, a stream).
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export const isSerializable = (value: unknown): boolean =>
	!(value instanceof Response) &&
	!(value instanceof ElysiaStatus) &&
	!(value instanceof ReadableStream) &&
	!(value instanceof Blob) &&
	!(typeof value === 'object' && value !== null && Symbol.asyncIterator in value);

/**
 * Reads a sparse fieldset from a query: `fields=id,title` (or repeated `fields`).
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export const readFields = (query: Record<string, unknown> | undefined): string[] | undefined => {
	const raw = query?.fields;
	if (raw === undefined || raw === null || raw === '') return undefined;
	const values = Array.isArray(raw) ? raw : [raw];
	return values.flatMap((value) => String(value).split(',')).map((field) => field.trim());
};
