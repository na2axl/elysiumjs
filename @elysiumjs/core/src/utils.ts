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

import type { Elysia } from 'elysia';
import type { ModuleNode } from './module-graph';

import { isObject } from 'radash';

export namespace Symbols {
	export const app = Symbol('elysium:Application');

	export const controller = Symbol('elysium:Controller');

	export const middlewares = Symbol('elysium:MiddlewaresList');

	export const services = Symbol('elysium:ServicesList');

	export const websocket = Symbol('elysium:WebSocket');

	export const wamp = Symbol('elysium:Wamp');

	export const http = Symbol('elysium:Http');

	export const job = Symbol('elysium:Job');

	export const arg = Symbol('elysium:CommandArguments');

	export const elysiaPlugin = Symbol('elysium:ElysiaPlugin');

	export const middlewareGuards = Symbol('elysium:MiddlewareGuards');

	export const serviceOptions = Symbol('elysium:ServiceOptions');

	export const module = Symbol('elysium:Module');

	export const configuredModule = Symbol('elysium:ConfiguredModule');

	export const moduleConfig = Symbol('elysium:ModuleConfig');

	export const command = Symbol('elysium:Command');
}

/**
 * Gets the current environment name.
 * @returns `NODE_ENV`, or `development` when unset.
 *
 * @author Axel Nana <axel.nana@workbud.com>
 */
export function currentEnvironment(): string {
	return Bun.env.NODE_ENV ?? 'development';
}

export const nextTick = () => new Promise((resolve) => process.nextTick(resolve));

/** The factory stored on a controller class; builds its Elysia plugin in a module's context. */
export type ElysiaPlugin = (node: ModuleNode) => Promise<Elysia>;

/**
 * Copies plain objects and arrays recursively. Everything else (primitives, class
 * instances, functions) is kept by reference.
 */
function cloneValue<V>(value: V): V {
	if (Array.isArray(value)) return value.map(cloneValue) as V;
	if (isObject(value)) {
		const out: Record<string, any> = {};
		// Symbol keys are copied too (e.g. TypeBox schemas carry their kind under a symbol)
		for (const key of Reflect.ownKeys(value)) {
			if (Object.prototype.propertyIsEnumerable.call(value, key)) {
				out[key as string] = cloneValue((value as any)[key]);
			}
		}
		return out as V;
	}
	return value;
}

/**
 * Merges `source` into `target`. `target` must be a fresh object owned by the caller.
 */
function mergeInto(target: Record<string, any>, source: Record<string, any>): void {
	for (const key of Object.keys(source)) {
		const value = source[key];
		if (isObject(value)) {
			if (isObject(target[key])) {
				mergeInto(target[key], value);
			} else if (target[key] === undefined) {
				target[key] = cloneValue(value);
			}
		} else if (Array.isArray(value)) {
			if (!Array.isArray(target[key])) {
				target[key] = [];
			}
			const current: any[] = target[key];
			if (value.length > 0 && !isObject(value[0])) {
				// Merge arrays by concatenating and removing duplicates for primitive values
				target[key] = [...new Set([...current, ...value])];
			} else {
				// For arrays of objects, merge each item
				value.forEach((item: any, index: number) => {
					if (isObject(item) && isObject(current[index])) {
						mergeInto(current[index], item);
					} else if (!current.includes(item)) {
						current.push(cloneValue(item));
					}
				});
			}
		} else if (target[key] === undefined) {
			// Primitives, class instances and functions: the target's value wins, kept by reference
			target[key] = value;
		}
	}
}

/**
 * Deeply merges objects from right to left. The target's values win over the sources'.
 * Arrays are also merged if they are found in child objects.
 *
 * Neither `target` nor any source is mutated, and the result shares no plain object or
 * array with them. Class instances and functions are kept by reference.
 *
 * @param target The base object
 * @param sources One or more source objects providing the missing values
 * @returns A new merged object
 */
export function deepMerge<T extends Record<string, any | any[]>>(target: T, ...sources: T[]): T {
	const result = cloneValue(target) as Record<string, any>;
	for (const source of sources) {
		if (isObject(result) && isObject(source)) {
			mergeInto(result, source);
		}
	}
	return result as T;
}
