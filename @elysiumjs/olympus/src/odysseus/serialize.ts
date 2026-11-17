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

import type { ProblemClass, ProblemValidationError } from '../index.js';

import { DomainError } from '../index.js';

/**
 * A DomainError as a store keeps it: what it takes to give it back with its class.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type StoredProblem = {
	readonly code: string;
	readonly status: number;
	readonly name: string;
	readonly detail?: string;
	readonly title?: string;
	readonly errors?: readonly ProblemValidationError[];
	readonly retryAfterSeconds?: number;
	readonly extensions?: Readonly<Record<string, unknown>>;
};

/**
 * An error a run threw, as a store keeps it.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type StoredError = {
	readonly name: string;
	readonly message: string;
	/** The error, when it was a DomainError. */
	readonly problem?: StoredProblem;
};

/**
 * A copy of a value as it comes back from a store: JSON. Steps answer this copy on their first run
 * too, so that a workflow sees the same values when it is replayed.
 */
export const jsonCopy = <T>(value: T): T =>
	value === undefined ? (undefined as T) : (JSON.parse(JSON.stringify(value)) as T);

/** Keeps a DomainError. */
export const storeProblem = (error: DomainError): StoredProblem => ({
	code: error.code,
	status: error.status,
	name: error.name,
	...(error.detail === undefined ? {} : { detail: error.detail }),
	title: error.title,
	...(error.errors ? { errors: jsonCopy(error.errors) } : {}),
	...(error.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: error.retryAfterSeconds }),
	extensions: jsonCopy(error.extensions)
});

/** The class a problem is given back as when its code is not among the known classes. */
class StoredDomainError extends DomainError {}

/**
 * Gives a kept DomainError back. Its class is the one among `known` with its code, so that
 * `instanceof` checks hold on replay; other codes come back as a plain DomainError with the same
 * code, status, detail and extensions.
 * @param stored The kept error.
 * @param known The classes to give it back as.
 */
export const reviveProblem = (
	stored: StoredProblem,
	known: readonly ProblemClass[]
): DomainError => {
	const cls = known.find((candidate) => candidate.code === stored.code) ?? StoredDomainError;
	const error = Object.create(cls.prototype) as DomainError;
	const message = stored.detail ?? stored.code;
	Object.defineProperty(error, 'message', { value: message, writable: true, configurable: true });
	Object.assign(error, {
		name: stored.name,
		code: stored.code,
		status: stored.status,
		detail: stored.detail,
		title: stored.title ?? '',
		errors: stored.errors,
		retryAfterSeconds: stored.retryAfterSeconds,
		extensions: stored.extensions ?? {},
		headers:
			stored.retryAfterSeconds === undefined
				? undefined
				: { 'retry-after': String(stored.retryAfterSeconds) }
	});
	return error;
};

/** Keeps an error a run threw. */
export const storeError = (error: unknown): StoredError =>
	error instanceof DomainError
		? { name: error.name, message: error.message, problem: storeProblem(error) }
		: error instanceof Error
			? { name: error.name, message: error.message }
			: { name: 'Error', message: String(error) };

/** Whether a value is a kept DomainError. */
export const isStoredProblem = (value: unknown): value is StoredProblem =>
	typeof value === 'object' &&
	value !== null &&
	typeof (value as StoredProblem).code === 'string' &&
	typeof (value as StoredProblem).status === 'number';

/** The member that marks a kept DomainError among encoded values. */
const PROBLEM = '~problem';

/**
 * Encodes the value of a step or of `run()` for a store: a DomainError returned as the value is
 * kept with its code, so that it comes back with its class; any other value is copied as JSON,
 * DomainErrors nested in it included (they come back as plain objects).
 * @param value The value.
 */
export const encodeValue = (value: unknown): unknown =>
	value instanceof DomainError ? { [PROBLEM]: storeProblem(value) } : jsonCopy(value);

/**
 * Decodes a value encoded with {@link encodeValue}.
 * @param encoded The encoded value.
 * @param known The DomainError classes to give kept errors back as.
 */
export const decodeValue = (encoded: unknown, known: readonly ProblemClass[]): unknown => {
	if (typeof encoded === 'object' && encoded !== null && PROBLEM in encoded) {
		const stored = (encoded as Record<string, unknown>)[PROBLEM];
		if (isStoredProblem(stored)) return reviveProblem(stored, known);
	}
	return jsonCopy(encoded);
};
