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

import type { TObject, TOptional, TSchema, TString } from 'typebox';
import type { ModuleGraph } from './module-graph';

import { t } from 'elysia';
import Value from 'typebox/value';

import { ElysiumError } from './errors';

const SECRET = Symbol.for('elysium:Secret');

/** Marks the type of a schema made by `Secret.schema()`; it has no value at runtime. */
declare const SECRET_SCHEMA: unique symbol;

/**
 * The type of a schema made by {@link Secret.schema}: `Env.Infer` reads its value as a `Secret`.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type SecretSchema<S extends TSchema = TSchema> = S & { readonly [SECRET_SCHEMA]: S };

/** The schema under the mark of a {@link SecretSchema}, kept optional, or the schema itself. */
export type UnmarkedSchema<S extends TSchema> =
	S extends TOptional<infer Inner extends TSchema>
		? TOptional<UnmarkedSchema<Inner>>
		: S extends { readonly [SECRET_SCHEMA]: infer U extends TSchema }
			? U
			: S;
const REDACTED = '[secret]';

/**
 * A value that must not leak: it prints as `[secret]` in logs, `JSON.stringify`, string
 * conversion and error messages. Read it with `reveal()`.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @template T The type of the value.
 */
export class Secret<T = string> {
	readonly #value: T;

	constructor(value: T) {
		this.#value = value;
	}

	/** The secret value. Pass it where it is used, never to a log. */
	public reveal(): T {
		return this.#value;
	}

	public toString(): string {
		return REDACTED;
	}

	public toJSON(): string {
		return REDACTED;
	}

	public [Symbol.for('nodejs.util.inspect.custom')](): string {
		return REDACTED;
	}

	/**
	 * Marks an environment variable as a secret: once validated, it is read as a `Secret` from
	 * `Env.get()`.
	 * @param schema The schema of the value. Defaults to a string.
	 * @example
	 * ```ts
	 * @Application.register({ env: t.Object({ DATABASE_URL: Secret.schema() }) })
	 * ```
	 */
	public static schema(): SecretSchema<TString>;
	public static schema<S extends TSchema>(schema: S): SecretSchema<S>;
	public static schema(schema?: TSchema): SecretSchema {
		return { ...(schema ?? t.String()), [SECRET]: true } as unknown as SecretSchema;
	}

	/** Whether a schema was made by {@link Secret.schema}. */
	public static isSchema(schema: unknown): boolean {
		return typeof schema === 'object' && schema !== null && SECRET in schema;
	}
}

/**
 * One missing or invalid environment variable.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type EnvironmentIssue = { key: string; message: string };

/**
 * Thrown at boot when environment variables are missing or invalid. It lists every issue, and
 * never the values.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class InvalidEnvironmentError extends ElysiumError {
	constructor(public readonly issues: EnvironmentIssue[]) {
		super(
			`Invalid environment configuration:\n${issues.map((i) => `  - ${i.key}: ${i.message}`).join('\n')}`
		);
	}
}

/**
 * Thrown when two schemas declare the same environment variable differently.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class ConflictingEnvironmentSchemaError extends ElysiumError {
	constructor(
		public readonly key: string,
		public readonly owners: [string, string]
	) {
		super(
			`The environment variable "${key}" is declared differently by ${owners[0]} and ${owners[1]}. Declare it once, or with the same schema.`
		);
	}
}

/**
 * Merges the environment schema of the app with those of the active modules (`envSchema`).
 * @author Axel Nana <ax.lnana@outlook.com>
 * @param appSchema The `env` option of the application.
 * @param graph The module graph, or `null` for the app schema alone.
 * @throws {ConflictingEnvironmentSchemaError} When two schemas declare a key differently.
 */
export const mergeEnvironmentSchemas = (
	appSchema: TSchema | undefined,
	graph: ModuleGraph | null
): TObject | undefined => {
	const sources: [string, TSchema][] = [];
	if (appSchema) sources.push(['the application', appSchema]);
	for (const node of graph?.nodes ?? []) {
		if (node.props.envSchema) sources.push([`module ${node.id}`, node.props.envSchema]);
	}
	if (sources.length === 0) return undefined;

	const properties: Record<string, TSchema> = {};
	const owners: Record<string, string> = {};
	for (const [owner, schema] of sources) {
		const props = (schema as TObject).properties ?? {};
		for (const [key, property] of Object.entries(props)) {
			if (key in properties && JSON.stringify(properties[key]) !== JSON.stringify(property)) {
				throw new ConflictingEnvironmentSchemaError(key, [owners[key]!, owner]);
			}
			properties[key] = property as TSchema;
			owners[key] = owner;
		}
	}
	return t.Object(properties);
};

/**
 * Validates environment variables against a schema: applies defaults, converts strings to the
 * declared types, keeps only the declared keys and wraps secrets.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @param schema The merged schema.
 * @param raw The variables from the runtime.
 * @returns The validated variables.
 * @throws {InvalidEnvironmentError} Listing every missing or invalid variable.
 */
export const validateEnvironment = (
	schema: TObject,
	raw: Record<string, unknown>
): Record<string, unknown> => {
	// A plain copy: `process.env` turns every value assigned to it into a string.
	const value = Value.Convert(schema, Value.Default(schema, { ...raw }));

	const issues: EnvironmentIssue[] = [];
	for (const error of Value.Errors(schema, value)) {
		const missing = (error.params as { requiredProperties?: string[] })?.requiredProperties;
		if (Array.isArray(missing)) {
			for (const key of missing) issues.push({ key, message: 'is required' });
			continue;
		}
		const key = error.instancePath.replace(/^\//, '').split('/')[0] || '(root)';
		issues.push({ key, message: error.message });
	}
	if (issues.length > 0) throw new InvalidEnvironmentError(issues);

	const clean = Value.Clean(schema, value) as Record<string, unknown>;
	for (const [key, property] of Object.entries(schema.properties)) {
		if (Secret.isSchema(property) && clean[key] !== undefined) clean[key] = new Secret(clean[key]);
	}
	return clean;
};
