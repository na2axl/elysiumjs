// Copyright (c) 2026-present Workbud Technologies Inc. All rights reserved.
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

import type { Class } from 'type-fest';

import { Metadata } from './metadata';
import { Symbols } from './utils';

/**
 * What identifies a service in the container: the name it is registered under, or its class.
 *
 * A class registered without a name is identified by the class itself, never by the class name,
 * so services resolve the same way in minified builds, where bundlers rename classes.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type ServiceToken = string | Class<any>;

/**
 * The token a service is registered under: a string as given, and for a class the name declared
 * with `@Service.register({ name })`, or else the class itself.
 * @author Axel Nana <axel.nana@workbud.com>
 * @param service The service name or class.
 */
export const tokenOf = (service: ServiceToken): ServiceToken =>
	typeof service === 'string'
		? service
		: ((Metadata.get(Symbols.serviceOptions, service)?.name as string | undefined) ?? service);

/**
 * A readable label for a token, for messages only: it must never be used to look a service up.
 * @author Axel Nana <axel.nana@workbud.com>
 * @param token The service token.
 */
export const tokenLabel = (token: ServiceToken): string =>
	typeof token === 'string' ? token : token.name || '<anonymous class>';

/**
 * A tag that groups services: every service registered with it is injected together with
 * `@Service.injectAll(tag)`, or retrieved with `Service.getAll(tag)`. Tags are matched by name.
 * @author Axel Nana <axel.nana@workbud.com>
 * @template T The type every tagged service implements.
 */
export type ServiceTag<T = unknown> = {
	/** The name of the tag. */
	readonly tag: string;

	/** Carries the type of the tagged services; never set at runtime. */
	readonly __services?: T;
};

/**
 * Creates a tag.
 * @author Axel Nana <axel.nana@workbud.com>
 * @template T The type every tagged service implements.
 * @param name The name of the tag, unique in the application.
 */
export const serviceTag = <T>(name: string): ServiceTag<T> => Object.freeze({ tag: name });

/**
 * Checks whether a value is a service tag.
 * @author Axel Nana <axel.nana@workbud.com>
 * @param value The value to check.
 */
export const isServiceTag = (value: unknown): value is ServiceTag =>
	typeof value === 'object' &&
	value !== null &&
	typeof (value as { tag?: unknown }).tag === 'string';

/**
 * What a constructor or handler parameter receives from the container: one service by its token,
 * or every service of a tag.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type Injection =
	| { readonly token: ServiceToken; readonly index: number }
	| { readonly tag: ServiceTag; readonly index: number };
