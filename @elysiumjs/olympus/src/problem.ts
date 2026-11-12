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

import type { Static, TObject, TProperties } from 'typebox';

import { HTTPError, t } from 'elysia';
import { status as httpStatus } from 'http-status';

/**
 * An error response in the RFC 9457 "problem details" format, sent as
 * `application/problem+json`. Extension members sit at the top level, next to the standard ones.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type ProblemDetails = {
	/** A URI reference that identifies the problem type: the slug of its code, under `typeBase`. */
	type: string;
	/** A short summary of the problem type. */
	title: string;
	/** The HTTP status code. */
	status: number;
	/** The stable machine-readable code of the problem, such as `NOT_FOUND`. */
	code?: string;
	/** An explanation specific to this occurrence. */
	detail?: string;
	/** A URI reference that identifies this occurrence: the request path. */
	instance?: string;
	/** The id of the request, to find it in the logs. */
	requestId?: string;
	[extension: string]: unknown;
};

/**
 * One invalid value of a request, in the `errors` member of a validation problem.
 * @author Axel Nana <ax.lnana@outlook.com>
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
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type ProblemOptions = {
	/**
	 * The base of every problem `type`, such as `https://api.example.com/problems`: a problem of
	 * code `INSUFFICIENT_FUNDS` gets `https://api.example.com/problems/insufficient-funds`. Without
	 * it, `type` is the slug alone.
	 */
	typeBase?: string;

	/** The status of request validation errors. Defaults to 422. */
	validationStatus?: 400 | 422;

	/**
	 * The id of a request, served as `requestId` in its problems. Defaults to a valid
	 * `x-request-id` header, or a random UUID.
	 */
	requestId?: (request: Request) => string;
};

/** The MIME type of problem details responses. */
export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

/**
 * The standard reason phrase of an HTTP status, used as the default problem title.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @param status The HTTP status code.
 */
export const statusTitle = (status: number): string => {
	const name = (httpStatus as Record<number, unknown>)[status];
	if (typeof name === 'string') return name;
	return status >= 500 ? 'Server Error' : status >= 400 ? 'Client Error' : 'Error';
};

/**
 * The problem codes of the application, declared by merging into this interface: one key per code.
 * Once it has keys, `DomainError.for()` takes only those codes and the ones of the framework
 * ({@link ElysiumProblemCode}); while it has none, any string is a code.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @example
 * ```ts
 * declare module '@elysiumjs/olympus' {
 *   interface ProblemCatalogue {
 *     INSUFFICIENT_FUNDS: true;
 *     ACCOUNT_CLOSED: true;
 *   }
 * }
 * ```
 */
// biome-ignore lint/suspicious/noEmptyInterface: extended by applications through declaration merging.
export interface ProblemCatalogue {}

/**
 * The problem codes the framework packages answer with. An application that keeps its own
 * catalogue lists them too, so that its clients know every code.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export const ELYSIUM_PROBLEM_CODES = {
	/** 400: a request that cannot be read, such as a malformed body or invalid query. */
	BAD_REQUEST: 'BAD_REQUEST',
	/** 400 or 422: request values that do not match their schema; carries `errors`. */
	VALIDATION_FAILED: 'VALIDATION_FAILED',
	/** 401: the request has no valid credentials. */
	UNAUTHENTICATED: 'UNAUTHENTICATED',
	/** 403: the caller may not do this. */
	FORBIDDEN: 'FORBIDDEN',
	/** 404: no such resource or route. */
	NOT_FOUND: 'NOT_FOUND',
	/** 409: the request conflicts with the current state. */
	CONFLICT: 'CONFLICT',
	/** 413: the body is larger than the body limit. */
	PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
	/** 429: carries `retryAfter` and the Retry-After header. */
	RATE_LIMITED: 'RATE_LIMITED',
	/** 500: an unexpected failure. */
	INTERNAL_ERROR: 'INTERNAL_ERROR',
	/** 403: the CSRF token of a cookie session is missing or does not match (themis). */
	CSRF_TOKEN_MISMATCH: 'CSRF_TOKEN_MISMATCH',
	/** 403: a signed URL whose signature does not verify, or that expired (themis). */
	INVALID_SIGNATURE: 'INVALID_SIGNATURE',
	/** 400: a passkey ceremony that did not verify (themis). */
	PASSKEY_VERIFICATION_FAILED: 'PASSKEY_VERIFICATION_FAILED',
	/** 400: an OAuth sign-in that could not complete (themis). */
	OAUTH_CALLBACK_FAILED: 'OAUTH_CALLBACK_FAILED',
	/** 428: an idempotent command called without an Idempotency-Key (moirai). */
	IDEMPOTENCY_KEY_REQUIRED: 'IDEMPOTENCY_KEY_REQUIRED',
	/** 422: an Idempotency-Key used before for another request (moirai). */
	IDEMPOTENCY_KEY_REUSED: 'IDEMPOTENCY_KEY_REUSED',
	/** 410: the flow does not exist or expired (ariadne). */
	FLOW_EXPIRED: 'FLOW_EXPIRED',
	/** 410: the flow is finished (ariadne). */
	FLOW_COMPLETED: 'FLOW_COMPLETED',
	/** 409: a step the flow does not accept now; carries `nextSteps`, `backSteps`, `answer` (ariadne). */
	FLOW_UNEXPECTED_STEP: 'FLOW_UNEXPECTED_STEP',
	/** 409: another request is running the same step (ariadne). */
	FLOW_STEP_IN_PROGRESS: 'FLOW_STEP_IN_PROGRESS'
} as const;

/**
 * A problem code of the framework.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type ElysiumProblemCode = keyof typeof ELYSIUM_PROBLEM_CODES;

/**
 * A problem code: one of {@link ProblemCatalogue} or of the framework, or any string while the
 * catalogue is empty.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type ProblemCode = [keyof ProblemCatalogue] extends [never]
	? string
	: (keyof ProblemCatalogue & string) | ElysiumProblemCode;

/**
 * The `type` of a problem code: its kebab-case slug, under the base when one is set.
 * `INSUFFICIENT_FUNDS` gives `insufficient-funds`, or `https://api.example.com/problems/insufficient-funds`.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @param code The problem code.
 * @param base The `typeBase` of the application.
 */
export const problemType = (code: string, base?: string): string => {
	const slug = code.toLowerCase().replaceAll('_', '-');
	return base ? `${base.replace(/\/+$/, '')}/${slug}` : slug;
};

/**
 * The options of a {@link DomainError}.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @template X The extension members, typed from the `extensions` schema of `DomainError.for()`.
 */
export type DomainErrorOptions<X = Readonly<Record<string, unknown>>> = {
	/** The invalid values, served as `errors`. */
	errors?: readonly ProblemValidationError[];
	/** Seconds until the client may retry, served as `retryAfter` and the Retry-After header. */
	retryAfterSeconds?: number;
	/** Extra members of the problem; the standard members win over them. */
	extensions?: X;
	/** A title of its own. Defaults to the reason phrase of the status. */
	title?: string;
	/** The error that caused this one, kept for logs. */
	cause?: unknown;
};

/**
 * What `DomainError.for()` takes besides the code and the status.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @template E The schemas of the extension members.
 */
export type DomainErrorDefinition<E extends TProperties = {}> = {
	/**
	 * The schemas of the extension members, documented in the problem's schema and typing the
	 * `extensions` of the constructor.
	 */
	extensions?: E;
	/** What the problem means, for the OpenAPI document. */
	description?: string;
};

/**
 * The extension members of a problem class: typed from its schemas, or any record without them.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type ProblemExtensions<E extends TProperties> = [keyof E] extends [never]
	? Readonly<Record<string, unknown>>
	: Static<TObject<E>>;

/**
 * A class of {@link DomainError}, with its code, status and the schema of its problem, as
 * `DomainError.for()` makes them. Routes list the ones they answer with in `errors`.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @template T The error the class makes.
 */
export type ProblemClass<T extends DomainError = DomainError> = (abstract new (
	...args: any[]
) => T) & {
	/** The problem code. */
	readonly code: string;
	/** The HTTP status. */
	readonly status: number;
	/** The schema of the problem: problem details with the literal code and status. */
	readonly schema: TObject;
};

/** The problem details members every problem of the framework carries besides the RFC ones. */
const problemMembers = () => ({
	requestId: t.Optional(t.String({ description: 'The id of the request, to find it in the logs.' }))
});

/** The schema of a problem: the RFC 9457 members, the literal code and status, and extensions. */
const problemSchemaOf = (
	code: string,
	status: number,
	definition: DomainErrorDefinition<TProperties>
): TObject =>
	t.Problem(
		{
			code: t.Literal(code),
			status: t.Literal(status),
			...problemMembers(),
			...definition.extensions
		},
		definition.description ? { description: definition.description } : {}
	) as unknown as TObject;

/** The schema of one invalid value, in the `errors` member of a problem. */
const validationErrorSchema = () =>
	t.Object({
		pointer: t.String({ description: 'A JSON Pointer to the value: /body/email.' }),
		message: t.String(),
		code: t.Optional(t.String())
	});

/**
 * The extension schemas of problems that list invalid values: `errors`, one per mistake.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export const validationExtensions = () => ({
	errors: t.Optional(t.Array(validationErrorSchema()))
});

/**
 * An error the application expects and reports to the client as problem details, and an Elysia
 * `HTTPError`. Each error is a class of its own, made with `DomainError.for(code, status)`, so a
 * signature names what can go wrong (`Promise<Account | AccountClosed>`).
 *
 * Handlers, commands, queries and flow steps return it (errors as values) or throw it; both send
 * the same problem, roll back the unit of work, and commit nothing. A returned error joins the
 * route's response type under its literal status, so typed clients see it. `message` is the
 * detail shown to the client.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @template C The problem code.
 * @template S The HTTP status.
 * @example
 * ```ts
 * export class InsufficientFunds extends DomainError.for('INSUFFICIENT_FUNDS', 409) {
 *   constructor(missing: number) {
 *     super(`${missing} more are needed.`, { extensions: { missing } });
 *   }
 * }
 *
 * public async pay(amount: number): Promise<Receipt | InsufficientFunds> {
 *   if (balance < amount) return new InsufficientFunds(amount - balance);
 *   ...
 * }
 * ```
 */
export abstract class DomainError<
	C extends string = string,
	S extends number = number
> extends HTTPError {
	/** The base of `type`, set from `problems.typeBase` of the application. */
	public static override typeBase?: string;

	public override readonly code: C;
	public override readonly status: S;
	/** The detail shown to the client; undefined when none was given. */
	public override readonly detail: string | undefined;
	public readonly title: string;
	public readonly errors: readonly ProblemValidationError[] | undefined;
	public readonly retryAfterSeconds: number | undefined;
	public readonly extensions: Readonly<Record<string, unknown>>;
	public override readonly headers: Record<string, string> | undefined;

	/** Protected: an error is created through its own class, made with `DomainError.for()`. */
	protected constructor(code: C, status: S, detail?: string, options: DomainErrorOptions = {}) {
		super(detail ?? code, options.cause instanceof Error ? options.cause : undefined);
		this.name = new.target.name;
		this.code = code;
		this.status = status;
		this.detail = detail;
		this.title = options.title ?? statusTitle(status);
		this.errors = options.errors;
		this.retryAfterSeconds = options.retryAfterSeconds;
		this.extensions = options.extensions ?? {};
		this.headers =
			options.retryAfterSeconds === undefined
				? undefined
				: { 'retry-after': String(options.retryAfterSeconds) };
	}

	/** The problem type: the slug of the code, under `typeBase`. */
	public override get type(): string {
		return problemType(this.code, DomainError.typeBase);
	}

	/**
	 * The base class of one error, with its code and status kept as literal types. The class has
	 * them as static members too, with `schema`: the problem details it is sent as, for the
	 * `errors` of routes and the OpenAPI document.
	 * @param code The problem code, from the {@link ProblemCatalogue} once it has keys.
	 * @param status The HTTP status.
	 * @param definition The schemas of the extension members, and a description.
	 * @example
	 * ```ts
	 * class InsufficientFunds extends DomainError.for('INSUFFICIENT_FUNDS', 409, {
	 *   extensions: { missing: t.Integer() }
	 * }) {}
	 *
	 * new InsufficientFunds('Top up first.', { extensions: { missing: 300 } });
	 * InsufficientFunds.schema; // { code: 'INSUFFICIENT_FUNDS', status: 409, missing: integer, ... }
	 * ```
	 */
	public static for<
		const C extends ProblemCode,
		const S extends number,
		const E extends TProperties = {}
	>(code: C, status: S, definition: DomainErrorDefinition<E> = {}) {
		let schema: TObject | undefined;
		return class extends DomainError<C, S> {
			/** The problem code. */
			public static readonly code: C = code;
			/** The HTTP status. */
			public static readonly status: S = status;

			/** The schema of the problem: problem details with the literal code and status. */
			public static get schema(): TObject {
				return (schema ??= problemSchemaOf(code, status, definition));
			}

			constructor(detail?: string, options?: DomainErrorOptions<ProblemExtensions<E>>) {
				super(code, status, detail, options as DomainErrorOptions);
			}
		};
	}

	/** The members besides type, code, status and detail: the extensions first, so that the standard ones win. */
	public override extension(): Record<string, unknown> {
		return {
			...this.extensions,
			title: this.title,
			...(this.retryAfterSeconds === undefined ? {} : { retryAfter: this.retryAfterSeconds }),
			...(this.errors ? { errors: [...this.errors] } : {})
		};
	}
}

/**
 * Checks whether a value is a {@link DomainError}, such as the result of a command.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export const isDomainError = (value: unknown): value is DomainError => value instanceof DomainError;

/**
 * A request that cannot be read: a 400 problem.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class BadRequestError extends DomainError.for('BAD_REQUEST', 400, {
	extensions: validationExtensions()
}) {}

/**
 * Request values that do not match their schema: a 422 problem with one entry per mistake.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class ValidationFailedError extends DomainError.for('VALIDATION_FAILED', 422, {
	extensions: validationExtensions()
}) {
	constructor(errors: readonly ProblemValidationError[], detail = 'The request is invalid.') {
		super(detail, { errors });
	}
}

/**
 * A request without valid credentials: a 401 problem.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class UnauthenticatedError extends DomainError.for('UNAUTHENTICATED', 401) {
	constructor(detail = 'Authentication is required.') {
		super(detail);
	}
}

/**
 * A caller that may not do this: a 403 problem.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class ForbiddenError extends DomainError.for('FORBIDDEN', 403) {}

/**
 * A resource that does not exist: a 404 problem.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class NotFoundError extends DomainError.for('NOT_FOUND', 404) {}

/**
 * A request that conflicts with the current state: a 409 problem.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class ConflictError extends DomainError.for('CONFLICT', 409) {}

/**
 * An unexpected failure: a 500 problem. Anything thrown that is not a DomainError is sent as one,
 * with its detail and stack only in development and test.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class InternalError extends DomainError.for('INTERNAL_ERROR', 500, {
	extensions: { stack: t.Optional(t.Array(t.String(), { description: 'In development and test only.' })) }
}) {}

/**
 * The schema of the problems request validation answers with, at the `validationStatus` of the
 * application.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @param status The status of validation errors: 422 or 400.
 */
export const validationProblemSchema = (status: number): TObject =>
	status === ValidationFailedError.status
		? ValidationFailedError.schema
		: problemSchemaOf(ELYSIUM_PROBLEM_CODES.VALIDATION_FAILED, status, {
				extensions: validationExtensions()
			});

/**
 * Checks whether a value is a problem details object: a `status` number and a `title` string.
 * @author Axel Nana <ax.lnana@outlook.com>
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
 * @author Axel Nana <ax.lnana@outlook.com>
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
 * @author Axel Nana <ax.lnana@outlook.com>
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
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type ProblemContext = Omit<ProblemOptions, 'requestId'> & {
	/** The request path, used as `instance`. */
	path?: string;
	/** The id of the request, served as `requestId`. */
	requestId?: string;
	/** Whether to include the detail and the stack of server errors. */
	development: boolean;
};

const REQUEST_ID = /^[\w.:-]{1,128}$/;
const requestIds = new WeakMap<Request, string>();

/**
 * The id of a request: the one `make` gives, a valid `x-request-id` header, or a random UUID.
 * The same request always gets the same id.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @param request The request.
 * @param make The `requestId` option of the application.
 */
export const requestIdOf = (request: Request, make?: (request: Request) => string): string => {
	let id = requestIds.get(request);
	if (id === undefined) {
		const header = request.headers.get('x-request-id');
		id = make?.(request) ?? (header && REQUEST_ID.test(header) ? header : crypto.randomUUID());
		requestIds.set(request, id);
	}
	return id;
};

/**
 * Turns any error thrown or returned while handling a request into problem details. Every problem
 * carries `code`, and the `requestId` and `instance` of the request when they are known.
 *
 * - A {@link DomainError} keeps its code, status, title, detail and members.
 * - Elysia's request validation errors give `VALIDATION_FAILED` at `validationStatus` (422), with
 *   an `errors` list, except for headers: missing or malformed headers give `BAD_REQUEST` (400),
 *   with the same list.
 * - Elysia's not found, parse and invalid cookie signature errors give `NOT_FOUND` (404) and
 *   `BAD_REQUEST` (400).
 * - Anything else is an `INTERNAL_ERROR` (500) whose detail and stack are only shown in
 *   development and test.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @param error The thrown or returned value.
 * @param context The request and the application's problem options.
 */
export const toProblem = (error: unknown, context: ProblemContext): ProblemDetails => {
	const request = {
		...(context.requestId !== undefined ? { requestId: context.requestId } : {}),
		...(context.path !== undefined ? { instance: context.path } : {})
	};
	const make = (
		code: string,
		status: number,
		members: Record<string, unknown> = {}
	): ProblemDetails => {
		// The standard members come first and win over the extensions of the same name.
		const {
			type: _t,
			title,
			status: _s,
			code: _c,
			detail,
			instance: _i,
			requestId: _r,
			...rest
		} = members;
		return {
			type: problemType(code, context.typeBase),
			title: typeof title === 'string' ? title : statusTitle(status),
			status,
			code,
			...(typeof detail === 'string' ? { detail } : {}),
			...rest,
			...request
		};
	};

	if (error instanceof DomainError) {
		const showDetail = error.detail !== undefined && (error.status < 500 || context.development);
		return make(error.code, error.status, {
			...error.extension(),
			...(showDetail ? { detail: error.detail } : {})
		});
	}

	const elysia = error as { code?: unknown; status?: unknown; type?: string; all?: unknown[] };
	const code = typeof elysia?.code === 'string' ? elysia.code : undefined;

	if (code === 'validation' && elysia.status !== 500 && elysia.type === 'headers') {
		// Missing or malformed headers make a bad request, not invalid input.
		return make(ELYSIUM_PROBLEM_CODES.BAD_REQUEST, 400, {
			detail: 'The request headers are invalid.',
			errors: validationErrors('headers', elysia.all ?? [])
		});
	}

	if (code === 'validation' && elysia.status !== 500) {
		return make(ELYSIUM_PROBLEM_CODES.VALIDATION_FAILED, context.validationStatus ?? 422, {
			detail: `The request ${elysia.type ?? 'input'} is invalid.`,
			errors: validationErrors(elysia.type ?? 'body', elysia.all ?? [])
		});
	}

	if (code === 'not-found') return make(ELYSIUM_PROBLEM_CODES.NOT_FOUND, 404);
	if (code === 'parse' || code === 'invalid-cookie-signature') {
		return make(ELYSIUM_PROBLEM_CODES.BAD_REQUEST, 400);
	}

	const members: Record<string, unknown> = {};
	if (context.development && error instanceof Error) {
		members.detail = error.message;
		if (error.stack) members.stack = error.stack.split('\n').map((line) => line.trim());
	}
	return make(ELYSIUM_PROBLEM_CODES.INTERNAL_ERROR, 500, members);
};

/**
 * Builds the `application/problem+json` response of a problem.
 * @author Axel Nana <ax.lnana@outlook.com>
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
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export const ProblemDetailsSchema = t.Object(
	{
		type: t.String(),
		title: t.String(),
		status: t.Integer(),
		code: t.String(),
		detail: t.Optional(t.String()),
		instance: t.Optional(t.String()),
		requestId: t.Optional(t.String()),
		retryAfter: t.Optional(t.Integer()),
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
