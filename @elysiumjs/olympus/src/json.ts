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

import { Serializer, UnknownSerializerError } from './serializer';

/** The key that names the serializer of an encoded value. */
const TYPE = '$type';

/** The key that holds the serialized form of an encoded value. */
const VALUE = '$value';

/** The key that escapes a plain object that looks like an encoded value. */
const ESCAPED = '$escaped';

/** Whether a value is a plain object: made by `{}` or with a null prototype. */
const isPlainObject = (value: unknown): value is Record<string, unknown> => {
	if (typeof value !== 'object' || value === null) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
};

/** Whether an object has exactly these keys. */
const hasKeys = (value: Record<string, unknown>, ...keys: string[]): boolean => {
	const own = Object.keys(value);
	return own.length === keys.length && keys.every((key) => own.includes(key));
};

/** Whether a plain object has the shape of an encoded value or of an escape. */
const looksTagged = (value: Record<string, unknown>): boolean =>
	hasKeys(value, TYPE, VALUE) || hasKeys(value, ESCAPED);

/** Whether a value is written as it is: `null`, a string, a boolean or a number. */
const isScalar = (value: unknown): value is null | string | boolean | number =>
	value === null || ['string', 'boolean', 'number'].includes(typeof value);

/** Whether a value comes back from JSON as it was, with no cycle through `seen`. */
const fits = (value: unknown, seen: Set<object>): boolean => {
	if (isScalar(value)) return typeof value !== 'number' || Number.isFinite(value);
	if (typeof value === 'object' && seen.has(value!)) return false;
	const match = Serializer.for(value);
	if (match) {
		if (typeof value === 'object') seen.add(value!);
		try {
			return fits(match.serializer.serialize(value), seen);
		} catch {
			return false;
		} finally {
			if (typeof value === 'object') seen.delete(value!);
		}
	}
	if (!Array.isArray(value) && !isPlainObject(value)) return false;
	seen.add(value);
	const items = Array.isArray(value) ? Array.from(value) : Object.values(value);
	const ok = items.every((item) => fits(item, seen));
	seen.delete(value);
	return ok;
};

/** Reads back the entries of a plain object. */
const decodeEntries = (value: Record<string, unknown>): Record<string, unknown> =>
	Object.fromEntries(Object.entries(value).map(([key, item]) => [key, Json.decode(item)]));

/**
 * JSON that keeps more than JSON does: each value a registered {@link Serializer} supports, such as
 * a `Date`, is written as `{ "$type": "<name>", "$value": <serialized> }` and read back as it
 * was, at any depth. A plain object that already has that shape is escaped, so that it reads back
 * unchanged. Made for values that cross a JSON boundary and come back, such as the input of a
 * queued action or the arguments of a job.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @example
 * ```ts
 * const text = Json.stringify({ at: new Date('2026-01-01') });
 * Json.parse<{ at: Date }>(text).at instanceof Date; // true
 * ```
 */
export namespace Json {
	/**
	 * The JSON-safe form of a value: the values of serializers as tagged objects, and everything
	 * else as `JSON.stringify` would see it.
	 * @param value The value.
	 */
	export const encode = (value: unknown): unknown => {
		if (isScalar(value)) return value;
		const match = Serializer.for(value);
		if (match) return { [TYPE]: match.name, [VALUE]: encode(match.serializer.serialize(value)) };
		if (Array.isArray(value)) return value.map(encode);
		if (isPlainObject(value)) {
			const entries = Object.entries(value).map(([key, item]) => [key, encode(item)] as const);
			const encoded = Object.fromEntries(entries);
			return looksTagged(value) ? { [ESCAPED]: encoded } : encoded;
		}
		return value;
	};

	/**
	 * Reads back a value that {@link encode} wrote: tagged objects go through their serializer.
	 * @param value The JSON-safe form.
	 * @throws {UnknownSerializerError} When a tagged object names a serializer that is not
	 * registered.
	 */
	export const decode = <T = unknown>(value: unknown): T => {
		if (Array.isArray(value)) return value.map(decode) as T;
		if (!isPlainObject(value)) return value as T;
		if (hasKeys(value, TYPE, VALUE) && typeof value[TYPE] === 'string') {
			const match = Serializer.find(value[TYPE]);
			if (!match) throw new UnknownSerializerError(value[TYPE]);
			return match.serializer.deserialize(decode(value[VALUE])) as T;
		}
		if (hasKeys(value, ESCAPED) && isPlainObject(value[ESCAPED])) {
			return decodeEntries(value[ESCAPED]) as T;
		}
		return decodeEntries(value) as T;
	};

	/**
	 * Writes a value as JSON, with the values of serializers.
	 * @param value The value.
	 */
	export const stringify = (value: unknown): string => JSON.stringify(encode(value));

	/**
	 * Reads JSON that {@link stringify} wrote, with the values of serializers.
	 * @param text The JSON text.
	 * @throws {UnknownSerializerError} When the text names a serializer that is not registered.
	 */
	export const parse = <T = unknown>(text: string): T => decode<T>(JSON.parse(text));

	/**
	 * Whether a value comes back from {@link parse} as it was: `null`, booleans, finite numbers,
	 * strings, values a serializer supports, and arrays and plain objects of those. Functions,
	 * class instances without a serializer, `undefined`, `NaN` and cycles are refused, since JSON
	 * drops or changes them.
	 * @param value The value.
	 */
	export const survives = (value: unknown): boolean => fits(value, new Set());
}
