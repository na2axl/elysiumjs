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

/** The key that tags an encoded date. */
const DATE = '$date';

/** The key that escapes a plain object whose only key is a tag. */
const ESCAPED = '$escaped';

/** Whether a value is a plain object: made by `{}` or with a null prototype. */
const isPlainObject = (value: unknown): value is Record<string, unknown> => {
	if (typeof value !== 'object' || value === null) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
};

/** Whether an object has exactly one key, and it is that one. */
const onlyKey = (value: Record<string, unknown>, key: string): boolean => {
	const keys = Object.keys(value);
	return keys.length === 1 && keys[0] === key;
};

/** Whether a value is plain JSON data or dates, with no cycle through `seen`. */
const fits = (value: unknown, seen: Set<object>): boolean => {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
	if (typeof value === 'number') return Number.isFinite(value);
	if (value instanceof Date) return !Number.isNaN(value.getTime());
	if (typeof value !== 'object' || seen.has(value)) return false;
	if (!Array.isArray(value) && !isPlainObject(value)) return false;
	seen.add(value);
	const items = Array.isArray(value) ? Array.from(value) : Object.values(value);
	const ok = items.every((item) => fits(item, seen));
	seen.delete(value);
	return ok;
};

/**
 * JSON that keeps dates: a `Date` is written as `{ "$date": "<ISO string>" }` and read back as a
 * `Date`, at any depth. A plain object that already has that shape is escaped, so that it reads
 * back as it was. Made for values that cross a JSON boundary and come back, such as the input of
 * a queued action or the arguments of a job.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @example
 * ```ts
 * const text = Json.stringify({ at: new Date('2026-01-01') });
 * Json.parse<{ at: Date }>(text).at instanceof Date; // true
 * ```
 */
export namespace Json {
	/**
	 * The JSON-safe form of a value: its dates as tagged objects, and everything else as
	 * `JSON.stringify` would see it.
	 * @param value The value.
	 */
	export const encode = (value: unknown): unknown => {
		if (value instanceof Date) return { [DATE]: value.toISOString() };
		if (Array.isArray(value)) return value.map(encode);
		if (isPlainObject(value)) {
			const entries = Object.entries(value).map(([key, item]) => [key, encode(item)] as const);
			const encoded = Object.fromEntries(entries);
			return onlyKey(value, DATE) || onlyKey(value, ESCAPED) ? { [ESCAPED]: encoded } : encoded;
		}
		return value;
	};

	/**
	 * Reads back a value that {@link encode} wrote: tagged objects become dates again.
	 * @param value The JSON-safe form.
	 */
	export const decode = <T = unknown>(value: unknown): T => {
		if (Array.isArray(value)) return value.map(decode) as T;
		if (isPlainObject(value)) {
			if (onlyKey(value, DATE) && typeof value[DATE] === 'string')
				return new Date(value[DATE]) as T;
			if (onlyKey(value, ESCAPED) && isPlainObject(value[ESCAPED])) {
				const inner = value[ESCAPED];
				return Object.fromEntries(
					Object.entries(inner).map(([key, item]) => [key, decode(item)])
				) as T;
			}
			return Object.fromEntries(
				Object.entries(value).map(([key, item]) => [key, decode(item)])
			) as T;
		}
		return value as T;
	};

	/**
	 * Writes a value as JSON, its dates included.
	 * @param value The value.
	 */
	export const stringify = (value: unknown): string => JSON.stringify(encode(value));

	/**
	 * Reads JSON that {@link stringify} wrote, its dates included.
	 * @param text The JSON text.
	 */
	export const parse = <T = unknown>(text: string): T => decode<T>(JSON.parse(text));

	/**
	 * Whether a value comes back from {@link parse} as it was: only `null`, booleans, finite
	 * numbers, strings, valid dates, arrays and plain objects of those. Functions, maps, sets, class
	 * instances, `undefined`, `NaN` and cycles are refused, since JSON drops or changes them.
	 * @param value The value.
	 */
	export const survives = (value: unknown): boolean => fits(value, new Set());
}
