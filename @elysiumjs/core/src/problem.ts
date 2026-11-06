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

import { t } from 'elysia';
import { status as httpStatus } from 'http-status';

import { ElysiumError } from './errors';

/**
 * An error response in the RFC 9457 "problem details" format, sent as
 * `application/problem+json`. Extension members sit at the top level, next to the standard ones.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type ProblemDetails = {
	/** A URI reference that identifies the problem type. `about:blank` when the status says it all. */
	type: string;
	/** A short summary of the problem type. */
	title: string;
	/** The HTTP status code. */
	status: number;
	/** An explanation specific to this occurrence. */
	detail?: string;
	/** A URI reference that identifies this occurrence: the request path. */
	instance?: string;
	[extension: string]: unknown;
};

/**
 * One invalid value of a request, in the `errors` member of a validation problem.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type ProblemValidationError = {
	/** A JSON Pointer (RFC 6901) to the value, rooted at the request part: `/body/email`. */
	pointer: string;
	/** What is wrong with it. */
	message: string;
	/** The rule that failed, such as `format` or `requiredProperties`. */
	code?: string;
};

/**
 * Options of the problem details rendering, set with `problems` on `@Application.register()`.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type ProblemOptions = {
	/**
	 * Prefixed to the `type` of a `DomainError` when it is relative, such as
	 * `https://api.example.com/problems/`.
	 */
	typeBase?: string;

	/** The status of request validation errors. Defaults to 422. */
	validationStatus?: 400 | 422;
};

/** The MIME type of problem details responses. */
export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

/**
 * The standard reason phrase of an HTTP status, used as the default problem title.
 * @author Axel Nana <axel.nana@workbud.com>
 * @param status The HTTP status code.
 */
export const statusTitle = (status: number): string => {
	const name = (httpStatus as Record<number, unknown>)[status];
	if (typeof name === 'string') return name;
	return status >= 500 ? 'Server Error' : status >= 400 ? 'Client Error' : 'Error';
};

/**
 * The fields of a {@link DomainError}.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type DomainErrorProps = {
	/** The HTTP status code. */
	status: number;
	/** A URI reference for the problem type. Defaults to `about:blank`. */
	type?: string;
	/** A short summary of the problem type. Defaults to the status reason phrase. */
	title?: string;
	/** An explanation specific to this occurrence. */
	detail?: string;
	/** Extra members of the problem details, such as `balance` or `retryAfter`. */
	extensions?: Record<string, unknown>;
};

/**
 * An error the application expects and reports to the client, rendered as problem details with
 * its own status. Throw it from handlers, services and middlewares, or subclass it per problem.
 * @author Axel Nana <axel.nana@workbud.com>
 * @example
 * ```ts
 * class InsufficientFundsError extends DomainError {
 *   constructor(balance: number) {
 *     super({ status: 409, type: 'insufficient-funds', title: 'Insufficient funds', extensions: { balance } });
 *   }
 * }
 * ```
 */
export class DomainError extends ElysiumError {
	public readonly status: number;
	public readonly type: string;
	public readonly title: string;
	public readonly detail?: string;
	public readonly extensions: Record<string, unknown>;

	constructor(props: DomainErrorProps) {
		const title = props.title ?? statusTitle(props.status);
		super(props.detail ?? title);
		this.name = new.target.name;
		this.status = props.status;
		this.type = props.type ?? 'about:blank';
		this.title = title;
		this.detail = props.detail;
		this.extensions = props.extensions ?? {};
	}

	/** A 400 Bad Request. */
	public static badRequest(detail?: string, extensions?: Record<string, unknown>): DomainError {
		return new DomainError({ status: 400, detail, extensions });
	}

	/** A 401 Unauthorized. */
	public static unauthorized(detail?: string, extensions?: Record<string, unknown>): DomainError {
		return new DomainError({ status: 401, detail, extensions });
	}

	/** A 403 Forbidden. */
	public static forbidden(detail?: string, extensions?: Record<string, unknown>): DomainError {
		return new DomainError({ status: 403, detail, extensions });
	}

	/** A 404 Not Found. */
	public static notFound(detail?: string, extensions?: Record<string, unknown>): DomainError {
		return new DomainError({ status: 404, detail, extensions });
	}

	/** A 409 Conflict. */
	public static conflict(detail?: string, extensions?: Record<string, unknown>): DomainError {
		return new DomainError({ status: 409, detail, extensions });
	}

	/** A 422 Unprocessable Content. */
	public static unprocessable(detail?: string, extensions?: Record<string, unknown>): DomainError {
		return new DomainError({ status: 422, detail, extensions });
	}
}

/**
 * Checks whether a value is a problem details object: a `status` number and a `title` string.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export const isProblemDetails = (value: unknown): value is ProblemDetails =>
	typeof value === 'object' &&
	value !== null &&
	!(value instanceof Response) &&
	typeof (value as ProblemDetails).status === 'number' &&
	typeof (value as ProblemDetails).title === 'string' &&
	typeof (value as ProblemDetails).type === 'string';

/**
 * Elysia wraps anything thrown while parsing the body (such as a body over the size limit) in a
 * parse error. Returns the wrapped error when it is a {@link DomainError}, so that it keeps its
 * own status, and the error itself otherwise.
 * @author Axel Nana <axel.nana@workbud.com>
 * @param error The thrown value.
 */
export const unwrapParseError = (error: unknown): unknown => {
	const wrapped = error as { code?: unknown; cause?: unknown } | null;
	return wrapped?.code === 'parse' && wrapped.cause instanceof DomainError ? wrapped.cause : error;
};

const escapePointer = (segment: string) => segment.replaceAll('~', '~0').replaceAll('/', '~1');

/** Joins a request part and a validator path (`root`, `email`, `items.0.name`) into a pointer. */
const pointerOf = (part: string, path: string | undefined, child?: string): string => {
	const segments = path && path !== 'root' ? path.split(/[./]/).filter(Boolean) : [];
	if (child) segments.push(child);
	return ['', part, ...segments.map(escapePointer)].join('/');
};

/**
 * Turns the errors of an Elysia validation error into problem `errors`, one per invalid value.
 * A missing required property is reported at the property's own pointer.
 * @author Axel Nana <axel.nana@workbud.com>
 * @param part The request part: `body`, `query`, `params`, `headers` or `cookie`.
 * @param errors The validator errors (`ValidationError.all`).
 */
export const validationErrors = (part: string, errors: unknown[]): ProblemValidationError[] => {
	const result: ProblemValidationError[] = [];
	for (const raw of errors) {
		const error = raw as {
			path?: string;
			instancePath?: string;
			message?: string;
			params?: Record<string, unknown>;
			keyword?: string;
		};
		const path = error.path ?? error.instancePath?.replace(/^\//, '');
		const params = error.params ?? {};
		const code = error.keyword ?? Object.keys(params)[0];
		const missing = params.requiredProperties as string[] | undefined;
		if (Array.isArray(missing) && missing.length > 0) {
			for (const property of missing) {
				result.push({ pointer: pointerOf(part, path, property), message: 'is required', code });
			}
			continue;
		}
		result.push({
			pointer: pointerOf(part, path),
			message: error.message ?? 'is invalid',
			...(code ? { code } : {})
		});
	}
	return result;
};

/**
 * The context {@link toProblem} needs about the request and the application.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type ProblemContext = ProblemOptions & {
	/** The request path, used as `instance`. */
	path?: string;
	/** Whether to include the detail and the stack of server errors. */
	development: boolean;
};

const prefixType = (type: string, base: string | undefined): string =>
	!base || type === 'about:blank' || /^[a-z][a-z0-9+.-]*:/i.test(type)
		? type
		: base.replace(/\/?$/, '/') + type.replace(/^\//, '');

/**
 * Turns any error thrown while handling a request into problem details.
 *
 * - A {@link DomainError} keeps its status, type, title, detail and extensions.
 * - Elysia's request validation errors give `validationStatus` (422) with an `errors` list.
 * - Elysia's not found, parse and invalid cookie signature errors give 404, 400 and 400.
 * - Anything else is a 500 whose detail and stack are only shown in development.
 * @author Axel Nana <axel.nana@workbud.com>
 * @param error The thrown value.
 * @param context The request path and the application's problem options.
 */
export const toProblem = (error: unknown, context: ProblemContext): ProblemDetails => {
	const instance = context.path ? { instance: context.path } : {};

	if (error instanceof DomainError) {
		return {
			...error.extensions,
			type: prefixType(error.type, context.typeBase),
			title: error.title,
			status: error.status,
			...(error.detail !== undefined ? { detail: error.detail } : {}),
			...instance
		};
	}

	const elysia = error as { code?: unknown; status?: unknown; type?: string; all?: unknown[] };
	const code = typeof elysia?.code === 'string' ? elysia.code : undefined;

	if (code === 'validation' && elysia.status !== 500) {
		const status = context.validationStatus ?? 422;
		return {
			type: 'about:blank',
			title: statusTitle(status),
			status,
			detail: `The request ${elysia.type ?? 'input'} is invalid.`,
			...instance,
			errors: validationErrors(elysia.type ?? 'body', elysia.all ?? [])
		};
	}

	const clientErrors: Record<string, number> = {
		'not-found': 404,
		parse: 400,
		'invalid-cookie-signature': 400
	};
	if (code && code in clientErrors) {
		const status = clientErrors[code]!;
		return { type: 'about:blank', title: statusTitle(status), status, ...instance };
	}

	const status = 500;
	const problem: ProblemDetails = {
		type: 'about:blank',
		title: statusTitle(status),
		status,
		...instance
	};
	if (context.development && error instanceof Error) {
		problem.detail = error.message;
		if (error.stack) problem.stack = error.stack.split('\n').map((line) => line.trim());
	}
	return problem;
};

/**
 * Builds the `application/problem+json` response of a problem.
 * @author Axel Nana <axel.nana@workbud.com>
 * @param problem The problem details.
 * @param headers Extra headers, such as `Retry-After`.
 */
export const problemResponse = (
	problem: ProblemDetails,
	headers?: Record<string, string>
): Response =>
	new Response(JSON.stringify(problem), {
		status: problem.status,
		headers: { ...headers, 'content-type': PROBLEM_CONTENT_TYPE }
	});

/**
 * The OpenAPI schema of problem details, referenced by the default error responses of each route.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export const ProblemDetailsSchema = t.Object(
	{
		type: t.String(),
		title: t.String(),
		status: t.Integer(),
		detail: t.Optional(t.String()),
		instance: t.Optional(t.String()),
		errors: t.Optional(
			t.Array(
				t.Object({
					pointer: t.String(),
					message: t.String(),
					code: t.Optional(t.String())
				})
			)
		)
	},
	{ additionalProperties: true, $id: 'ProblemDetails', description: 'RFC 9457 problem details' }
);
