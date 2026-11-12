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

import type { Static, TObject, TProperties, TSchema } from 'typebox';
import type { Secret, SecretSchema, UnmarkedSchema } from './config';

import { ElysiumError } from './errors';

/**
 * The validated environment variables of the application, by name. Empty in core: the app and
 * its modules add their variables by augmenting it next to their schemas, so that `Env.get()`
 * knows each name and the type of its value.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @example
 * ```ts
 * export const env = t.Object({ PORT: t.Number({ default: 3000 }) });
 *
 * declare module '@elysiumjs/core' {
 * 	interface AppEnv extends Env.Infer<typeof env> {}
 * }
 * ```
 */
// biome-ignore lint/suspicious/noEmptyInterface: augmented by applications and modules.
export interface AppEnv {}

/** The names `Env.get()` accepts: the declared ones, or any name while none is declared. */
export type EnvName = [keyof AppEnv] extends [never] ? string : Extract<keyof AppEnv, string>;

/** The type of a variable: its declared type, or a raw string while none is declared. */
export type EnvValue<TName> = TName extends keyof AppEnv ? AppEnv[TName] : string | undefined;

/** The validated type of one property: a `Secret` for a property made by `Secret.schema()`. */
type EnvProperty<TProperty, TValue> = TProperty extends SecretSchema
	? undefined extends TValue
		? Secret<Exclude<TValue, undefined>> | undefined
		: Secret<TValue>
	: TValue;

/** The validated values of an object's properties, with a `Secret` for each secret one. */
type InferProperties<TProps extends TProperties, TValues> = {
	[K in keyof TValues]: EnvProperty<TProps[K & keyof TProps], TValues[K]>;
};

const env: Map<string, unknown> = new Map();

/** Whether the variables wait for validation, which replaces the raw ones at boot. */
let pending = false;

/**
 * Raised when `Env` is read before the application validated its environment.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class EnvironmentNotReadyError extends ElysiumError {
	constructor(name: string) {
		super(
			`The environment variable "${name}" was read before the application validated its environment. Read it once the app runs or is built, such as in a module's onInit or a with() factory.`
		);
	}
}

/**
 * Initializes the environment variables.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @param vars The environment variables to initialize.
 */
export const initEnv = (vars: Record<string, unknown>) => {
	pending = false;
	for (const [key, value] of Object.entries(vars)) {
		env.set(key, value);
	}
};

/**
 * Empties the environment variables until the next {@link initEnv}: reading them in between
 * throws {@link EnvironmentNotReadyError}. The application calls it when it declares a schema,
 * so that no raw value is read as a validated one.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export const awaitEnv = () => {
	env.clear();
	pending = true;
};

export namespace Env {
	/**
	 * The validated type of an environment schema, for augmenting {@link AppEnv}: the static type
	 * of the schema, with a `Secret` for each property made by `Secret.schema()`.
	 * @author Axel Nana <ax.lnana@outlook.com>
	 */
	export type Infer<TEnv extends TSchema> =
		TEnv extends TObject<infer TProps extends TProperties>
			? InferProperties<TProps, Static<TObject<{ [K in keyof TProps]: UnmarkedSchema<TProps[K]> }>>>
			: Static<TEnv>;

	/**
	 * Gets the value of an environment variable.
	 * @author Axel Nana <ax.lnana@outlook.com>
	 * @param name The name of the environment variable.
	 * @param defaultValue The value to return when the variable is not set.
	 * @returns The value of the environment variable.
	 * @throws {EnvironmentNotReadyError} When read before the application validated its environment.
	 */
	export function get<TName extends EnvName>(name: TName): EnvValue<TName>;
	export function get<TName extends EnvName>(
		name: TName,
		defaultValue: Exclude<EnvValue<TName>, undefined>
	): Exclude<EnvValue<TName>, undefined>;
	export function get(name: string, defaultValue?: unknown): unknown {
		if (pending) throw new EnvironmentNotReadyError(name);
		return env.get(name) ?? defaultValue;
	}

	/**
	 * Checks if an environment variable exists.
	 * @author Axel Nana <ax.lnana@outlook.com>
	 * @param name The name of the environment variable.
	 * @returns `true` if the environment variable exists, `false` otherwise.
	 * @throws {EnvironmentNotReadyError} When read before the application validated its environment.
	 */
	export const exists = (name: EnvName): boolean => {
		if (pending) throw new EnvironmentNotReadyError(name);
		return env.has(name);
	};

	/**
	 * Clears the environment variables.
	 * @author Axel Nana <ax.lnana@outlook.com>
	 */
	export const clear = () => {
		env.clear();
		pending = false;
	};
}
