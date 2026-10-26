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

type MetadataKey = string | symbol;

type PropertyKey = string | symbol | undefined;

type Store = WeakMap<object, Map<PropertyKey, Map<MetadataKey, unknown>>>;

/** A `reflect-metadata` function, when another library has loaded it. */
type ForeignFunction = (...args: any[]) => unknown;

/** A value found on one object of a prototype chain. */
type Found = { value: unknown };

// Kept on the global object, so that every copy of this module shares one store.
const STORE_KEY = Symbol.for('elysium:metadata');

const store: Store = ((globalThis as Record<symbol, unknown>)[STORE_KEY] ??=
	new WeakMap()) as Store;

const foreign = (
	name: 'defineMetadata' | 'getOwnMetadata' | 'hasOwnMetadata'
): ForeignFunction | undefined => {
	const fn = (Reflect as unknown as Record<string, unknown>)[name];
	return typeof fn === 'function' ? (fn as ForeignFunction) : undefined;
};

/** Finds a value set on the target itself, in this store or in `reflect-metadata`'s. */
const findOwn = (key: MetadataKey, target: object, propertyKey: PropertyKey): Found | undefined => {
	const entries = store.get(target)?.get(propertyKey);
	if (entries?.has(key)) return { value: entries.get(key) };

	const getOwn = foreign('getOwnMetadata');
	if (!getOwn) return undefined;
	const hasOwn = foreign('hasOwnMetadata');
	const value = getOwn(key, target, propertyKey);
	const present = hasOwn ? hasOwn(key, target, propertyKey) : value !== undefined;
	return present ? { value } : undefined;
};

/** Finds a value on the target or its nearest parent that has one. */
const find = (key: MetadataKey, target: object, propertyKey: PropertyKey): Found | undefined => {
	for (let current: object | null = target; current; current = Object.getPrototypeOf(current)) {
		const found = findOwn(key, current, propertyKey);
		if (found) return found;
	}
	return undefined;
};

/**
 * Stores decorator metadata on classes and their members.
 *
 * Reads walk the prototype chain, so a subclass sees the metadata of its parents. When another
 * library has loaded `reflect-metadata`, values stored there are read as well.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export namespace Metadata {
	/**
	 * Sets a metadata value on a class, or on one of its members.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param key The metadata key.
	 * @param value The value to store.
	 * @param target The class, or the prototype holding the member.
	 * @param propertyKey The member name, when the metadata belongs to a member.
	 */
	export const define = (
		key: MetadataKey,
		value: unknown,
		target: object,
		propertyKey?: PropertyKey
	): void => {
		let members = store.get(target);
		if (!members) store.set(target, (members = new Map()));
		let entries = members.get(propertyKey);
		if (!entries) members.set(propertyKey, (entries = new Map()));
		entries.set(key, value);
	};

	/**
	 * Gets a metadata value set on the target itself, ignoring its parents.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param key The metadata key.
	 * @param target The class, or the prototype holding the member.
	 * @param propertyKey The member name, when the metadata belongs to a member.
	 */
	export const getOwn = <T = any>(
		key: MetadataKey,
		target: object,
		propertyKey?: PropertyKey
	): NoInfer<T> | undefined => findOwn(key, target, propertyKey)?.value as T | undefined;

	/**
	 * Gets a metadata value from the target or its nearest parent that has one.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param key The metadata key.
	 * @param target The class, or the prototype holding the member.
	 * @param propertyKey The member name, when the metadata belongs to a member.
	 */
	export const get = <T = any>(
		key: MetadataKey,
		target: object,
		propertyKey?: PropertyKey
	): NoInfer<T> | undefined => find(key, target, propertyKey)?.value as T | undefined;

	/**
	 * Checks whether the target or one of its parents has the key, even when its value is
	 * `undefined`.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param key The metadata key.
	 * @param target The class, or the prototype holding the member.
	 * @param propertyKey The member name, when the metadata belongs to a member.
	 */
	export const has = (key: MetadataKey, target: object, propertyKey?: PropertyKey): boolean =>
		find(key, target, propertyKey) !== undefined;
}

// With `emitDecoratorMetadata`, compilers pass the design types (`design:type`,
// `design:paramtypes`, `design:returntype`) to `Reflect.metadata`, and drop them when it is
// missing. This stores them here, and in `reflect-metadata` too when it is loaded later but
// keeps this `Reflect.metadata` (as version 0.1 does). When `reflect-metadata` is loaded first,
// it keeps its own `Reflect.metadata` and the readers above read its store.
if (typeof (Reflect as unknown as Record<string, unknown>).metadata !== 'function') {
	Object.defineProperty(Reflect, 'metadata', {
		configurable: true,
		writable: true,
		value:
			(key: MetadataKey, value: unknown) =>
			(target: object, propertyKey?: PropertyKey): void => {
				Metadata.define(key, value, target, propertyKey);
				foreign('defineMetadata')?.(key, value, target, propertyKey);
			}
	});
}
