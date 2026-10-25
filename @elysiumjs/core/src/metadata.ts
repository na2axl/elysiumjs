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

/** The `reflect-metadata` reader, when another library has loaded it. */
type ForeignReader = (key: MetadataKey, target: object, propertyKey?: PropertyKey) => unknown;

const store = new WeakMap<object, Map<PropertyKey, Map<MetadataKey, unknown>>>();

const ownEntries = (target: object, propertyKey: PropertyKey) =>
	store.get(target)?.get(propertyKey);

const foreign = (name: 'getMetadata' | 'getOwnMetadata'): ForeignReader | undefined => {
	const reader = (Reflect as unknown as Record<string, unknown>)[name];
	return typeof reader === 'function' ? (reader as ForeignReader) : undefined;
};

/**
 * Stores decorator metadata on classes and their members.
 *
 * Reads walk the prototype chain, so a subclass sees the metadata of its parents.
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
	): NoInfer<T> | undefined => {
		const entries = ownEntries(target, propertyKey);
		if (entries?.has(key)) return entries.get(key) as T;
		return foreign('getOwnMetadata')?.(key, target, propertyKey) as T | undefined;
	};

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
	): NoInfer<T> | undefined => {
		for (let current: object | null = target; current; current = Object.getPrototypeOf(current)) {
			const entries = ownEntries(current, propertyKey);
			if (entries?.has(key)) return entries.get(key) as T;
		}
		return foreign('getMetadata')?.(key, target, propertyKey) as T | undefined;
	};

	/**
	 * Checks whether the target or one of its parents has a metadata value.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param key The metadata key.
	 * @param target The class, or the prototype holding the member.
	 * @param propertyKey The member name, when the metadata belongs to a member.
	 */
	export const has = (key: MetadataKey, target: object, propertyKey?: PropertyKey): boolean =>
		get(key, target, propertyKey) !== undefined;
}

// With `emitDecoratorMetadata`, compilers pass the design types (`design:type`,
// `design:paramtypes`, `design:returntype`) to `Reflect.metadata`, and drop them when it is
// missing. This stores them here. When `reflect-metadata` is loaded, it keeps its own
// `Reflect.metadata` and the readers above fall back to it.
if (typeof (Reflect as unknown as Record<string, unknown>).metadata !== 'function') {
	Object.defineProperty(Reflect, 'metadata', {
		configurable: true,
		writable: true,
		value:
			(key: MetadataKey, value: unknown) =>
			(target: object, propertyKey?: PropertyKey): void =>
				Metadata.define(key, value, target, propertyKey)
	});
}
