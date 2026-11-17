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

import type { ProblemValidationError } from './problem.js';

import { DomainError } from './problem.js';
import { DuplicateSerializerError, Serializer } from './serializer.js';

/**
 * How a class is made serializable.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type SerializableOptions = {
	/**
	 * The name written with each instance: unique, and stable across deploys, since stored values
	 * carry it. Class names cannot serve, since bundlers rename classes.
	 */
	readonly name: string;
};

/** What a DomainError is written as. */
type ProblemFields = {
	code: string;
	status: number;
	name: string;
	detail?: string;
	title?: string;
	errors?: readonly ProblemValidationError[];
	retryAfterSeconds?: number;
	extensions?: Record<string, unknown>;
};

/** The own fields of a value that hold something, so that no `undefined` is written. */
const fieldsOf = (value: object): Record<string, unknown> =>
	Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));

/** The fields of a DomainError. */
const problemFields = (error: DomainError): ProblemFields =>
	fieldsOf({
		code: error.code,
		status: error.status,
		name: error.name,
		detail: error.detail,
		title: error.title,
		errors: error.errors,
		retryAfterSeconds: error.retryAfterSeconds,
		extensions: Object.keys(error.extensions).length > 0 ? error.extensions : undefined
	}) as ProblemFields;

/** A DomainError read back on a prototype, without its constructor. */
const reviveProblem = (prototype: object, fields: ProblemFields): DomainError => {
	const error = Object.create(prototype) as DomainError;
	Object.defineProperty(error, 'message', {
		value: fields.detail ?? fields.code,
		writable: true,
		configurable: true
	});
	Object.assign(error, {
		name: fields.name,
		code: fields.code,
		status: fields.status,
		detail: fields.detail,
		title: fields.title ?? '',
		errors: fields.errors,
		retryAfterSeconds: fields.retryAfterSeconds,
		extensions: fields.extensions ?? {},
		headers:
			fields.retryAfterSeconds === undefined
				? undefined
				: { 'retry-after': String(fields.retryAfterSeconds) }
	});
	return error;
};

/** The serializer made for each serializable class. */
const serializers = new WeakMap<Function, new () => Serializer<object, Record<string, unknown>>>();

/**
 * Makes the instances of a class survive `Json`, and so every boundary that uses it: the input
 * of a queued action, a cached value, the value of a workflow step. An instance is written as its
 * own fields, written with `Json` again, and read back on the prototype of the class, without
 * calling its constructor: keep the state of serializable classes in their fields. A DomainError
 * is written as its problem: code, status, detail, title, errors, extensions and retry delay.
 *
 * Only instances of the class itself match: decorate a subclass with a name of its own. A
 * DomainError that is not serializable reads back as a plain DomainError with the same code and
 * fields, and another error as an `Error` with its name and message.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @param options The name of the class in stored values.
 * @throws {DuplicateSerializerError} When another class or serializer has the name.
 * @example
 * ```ts
 * @Serializable({ name: 'payment-declined' })
 * export class PaymentDeclined extends DomainError.for('PAYMENT_DECLINED', 402) {}
 *
 * Json.parse(Json.stringify(new PaymentDeclined('Card refused.'))) instanceof PaymentDeclined; // true
 * ```
 */
export const Serializable =
	(options: SerializableOptions) =>
	(target: Function): void => {
		const existing = Serializer.find(options.name);
		const made = serializers.get(target);
		if (existing && existing.serializer.constructor !== made) {
			throw new DuplicateSerializerError(options.name);
		}
		const prototype = target.prototype as object;
		const isProblem = prototype instanceof DomainError;
		const serializer =
			made ??
			class extends Serializer<object, Record<string, unknown>> {
				public supports(value: unknown): boolean {
					return (
						typeof value === 'object' &&
						value !== null &&
						Object.getPrototypeOf(value) === prototype
					);
				}

				public serialize(value: object): Record<string, unknown> {
					return isProblem ? problemFields(value as DomainError) : fieldsOf(value);
				}

				public deserialize(fields: Record<string, unknown>): object {
					return isProblem
						? reviveProblem(prototype, fields as ProblemFields)
						: Object.assign(Object.create(prototype) as object, fields);
				}
			};
		serializers.set(target, serializer);
		// Above the fallbacks for errors, which match any DomainError or Error.
		Serializer.register({ name: options.name, priority: 10 })(serializer);
	};

/**
 * Whether a class was made serializable with {@link Serializable}.
 * @param target The class.
 */
Serializable.has = (target: Function): boolean => serializers.has(target);

/** The class a DomainError that is not serializable reads back as. */
class StoredDomainError extends DomainError {}

/**
 * Writes a DomainError whose class is not serializable as its problem, and reads it back as a
 * plain DomainError with the same code and fields.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
@Serializer.register({ name: 'problem', priority: -10 })
export class ProblemSerializer extends Serializer<DomainError, ProblemFields> {
	public supports(value: unknown): boolean {
		return value instanceof DomainError;
	}

	public serialize(value: DomainError): ProblemFields {
		return problemFields(value);
	}

	public deserialize(value: ProblemFields): DomainError {
		return reviveProblem(StoredDomainError.prototype, value);
	}
}

/**
 * Writes an error as its name and message, and reads it back as an `Error`.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
@Serializer.register({ name: 'error', priority: -20 })
export class ErrorSerializer extends Serializer<Error, { name: string; message: string }> {
	public supports(value: unknown): boolean {
		return value instanceof Error;
	}

	public serialize(value: Error): { name: string; message: string } {
		return { name: value.name, message: value.message };
	}

	public deserialize(value: { name: string; message: string }): Error {
		const error = new Error(value.message);
		error.name = value.name;
		return error;
	}
}
