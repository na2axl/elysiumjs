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

import type { AnyElysia } from 'elysia';

import { ParseError } from 'elysia';

import { ElysiumError } from './errors';
import { DomainError } from './problem';
import { Runtime } from './runtime';

/**
 * Cross-origin resource sharing options.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type CorsOptions = {
	/**
	 * The allowed origins: `*`, one origin, a list, a pattern, or a function of the origin and the
	 * request.
	 */
	origin: string | string[] | RegExp | ((origin: string, request: Request) => boolean);
	/** The allowed methods. Defaults to GET, HEAD, PUT, PATCH, POST and DELETE. */
	methods?: string[];
	/** The allowed request headers. Defaults to the headers the preflight asks for. */
	allowedHeaders?: string[];
	/** The response headers the browser may read. */
	exposedHeaders?: string[];
	/** Whether to allow cookies and authorization headers. Not allowed with `origin: '*'`. */
	credentials?: boolean;
	/** How long the browser may cache a preflight answer, in seconds. */
	maxAge?: number;
};

/**
 * Security response headers. `true` sends the default of a header, `false` or omitting it sends
 * nothing, and a string sends that value.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type SecurityHeadersOptions = {
	/** No default: an API serving JSON rarely needs one. */
	contentSecurityPolicy?: string | false;
	/** `max-age=15552000; includeSubDomains`, only sent on HTTPS requests. */
	strictTransportSecurity?: string | boolean;
	/** `nosniff`. */
	xContentTypeOptions?: boolean;
	/** `no-referrer`. */
	referrerPolicy?: string | boolean;
	/** `same-origin`. */
	crossOriginOpenerPolicy?: string | boolean;
	/** `same-origin`. */
	crossOriginResourcePolicy?: string | boolean;
	/** `DENY`. */
	xFrameOptions?: string | boolean;
};

/**
 * The HTTP options of an application, set with `http` on `@Application.register()`.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type HttpOptions = {
	/** Cross-origin resource sharing. Off unless set. */
	cors?: CorsOptions | false;
	/** Security headers: `true` for the defaults, or per header. */
	headers?: SecurityHeadersOptions | boolean;
	/**
	 * The largest request body the app parses, in bytes. Defaults to 1 MiB. Counted while reading,
	 * so it holds for chunked bodies and on every runtime. `false` turns it off.
	 */
	bodyLimit?: number | false;
	/**
	 * Which proxies to trust for the client address and protocol (`ctx.ip`, HSTS): `true` trusts
	 * every hop, a number trusts that many hops, and a list trusts those addresses.
	 */
	trustProxy?: boolean | number | string[];
};

/** The default body limit: 1 MiB. */
export const DEFAULT_BODY_LIMIT = 1024 * 1024;

/**
 * Raised when a request body is larger than the body limit. Rendered as a 413 problem.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class PayloadTooLargeError extends DomainError.for('PAYLOAD_TOO_LARGE', 413) {
	constructor(public readonly limit: number) {
		super(`The request body is larger than ${limit} bytes.`);
	}
}

/**
 * Thrown at startup when CORS allows every origin with credentials, which browsers refuse.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class InvalidCorsOptionsError extends ElysiumError {
	constructor() {
		super(
			'CORS cannot allow every origin ("*") with credentials. List the allowed origins instead.'
		);
	}
}

const DEFAULT_METHODS = ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE'];

const originAllowed = (cors: CorsOptions, origin: string, request: Request): boolean => {
	const { origin: allowed } = cors;
	if (allowed === '*') return true;
	if (typeof allowed === 'string') return allowed === origin;
	if (Array.isArray(allowed)) return allowed.includes(origin);
	if (allowed instanceof RegExp) return allowed.test(origin);
	return allowed(origin, request);
};

/** The value of a security header, from the option and its default. */
const headerValue = (
	option: string | boolean | undefined,
	fallback: string,
	defaults: boolean
): string | undefined => {
	if (typeof option === 'string') return option;
	if (option === true || (option === undefined && defaults)) return fallback;
	return undefined;
};

/**
 * The client address of a request, from the trusted proxy headers or the runtime.
 * @author Axel Nana <axel.nana@workbud.com>
 * @param request The request.
 * @param trustProxy Which proxies to trust.
 */
export const clientAddress = (
	request: Request,
	trustProxy: HttpOptions['trustProxy']
): string | undefined => {
	const direct = Runtime.find()?.clientAddress?.(request);
	if (!trustProxy) return direct;

	const forwarded = (request.headers.get('x-forwarded-for') ?? '')
		.split(',')
		.map((hop) => hop.trim())
		.filter(Boolean);
	if (forwarded.length === 0) return direct;

	// The chain from the client to us: forwarded hops, then the direct peer.
	const chain = direct ? [...forwarded, direct] : forwarded;
	if (trustProxy === true) return chain[0];
	if (typeof trustProxy === 'number') return chain[Math.max(0, chain.length - 1 - trustProxy)];

	// Walk back from the peer while the hop is a trusted proxy.
	let index = chain.length - 1;
	while (index > 0 && trustProxy.includes(chain[index]!)) index--;
	return chain[index];
};

/** Whether a request reached us over HTTPS, trusting `x-forwarded-proto` behind a proxy. */
const isHttps = (request: Request, trustProxy: HttpOptions['trustProxy']): boolean => {
	if (trustProxy) {
		const proto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
		if (proto) return proto === 'https';
	}
	return new URL(request.url).protocol === 'https:';
};

/** Reads a body stream, failing once more than `limit` bytes arrived. */
const readLimited = async (
	body: ReadableStream<Uint8Array>,
	limit: number
): Promise<Uint8Array> => {
	const reader = body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.byteLength;
		if (size > limit) {
			await reader.cancel();
			throw new PayloadTooLargeError(limit);
		}
		chunks.push(value);
	}
	const bytes = new Uint8Array(new ArrayBuffer(size));
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
};

const formToObject = (form: FormData | URLSearchParams): Record<string, unknown> => {
	const result: Record<string, unknown> = {};
	for (const key of new Set(form.keys())) {
		const values = form.getAll(key);
		result[key] = values.length > 1 ? values : values[0];
	}
	return result;
};

/** Parses a body the way Elysia does, for the content types the body limit applies to. */
const parseLimited = async (
	request: Request,
	contentType: string,
	limit: number
): Promise<unknown> => {
	const bytes = await readLimited(request.body!, limit);
	const text = () => new TextDecoder().decode(bytes);
	if (contentType.startsWith('application/json') || contentType.endsWith('+json')) {
		if (bytes.byteLength === 0) return undefined;
		try {
			return JSON.parse(text());
		} catch (error) {
			throw new ParseError(error as Error);
		}
	}
	if (contentType.startsWith('text/')) return text();
	if (contentType.startsWith('application/x-www-form-urlencoded')) {
		return formToObject(new URLSearchParams(text()));
	}
	return formToObject(
		await new Response(bytes as Uint8Array<ArrayBuffer>, {
			headers: { 'content-type': contentType }
		}).formData()
	);
};

const LIMITED_TYPES =
	/^(application\/(json|x-www-form-urlencoded)|text\/|multipart\/form-data)|\+json/;

/**
 * Registers the HTTP security hooks of an application on its root Elysia app: CORS, security
 * headers, the body limit and the client address (`ctx.ip`).
 * @author Axel Nana <axel.nana@workbud.com>
 * @param app The root Elysia app.
 * @param options The `http` option of the application.
 * @throws {InvalidCorsOptionsError} When CORS allows every origin with credentials.
 */
export const applyHttpSecurity = (app: AnyElysia, options: HttpOptions = {}): void => {
	const { cors, headers = false, bodyLimit = DEFAULT_BODY_LIMIT, trustProxy = false } = options;

	if (cors && cors.origin === '*' && cors.credentials) throw new InvalidCorsOptionsError();

	app.derive('global', ({ request }) => ({ ip: clientAddress(request, trustProxy) }));

	app.onRequest(({ request, set }) => {
		if (headers) {
			const all = headers === true ? {} : headers;
			const defaults = headers === true;
			const values: Record<string, string | undefined> = {
				'x-content-type-options':
					all.xContentTypeOptions === false
						? undefined
						: all.xContentTypeOptions || defaults
							? 'nosniff'
							: undefined,
				'referrer-policy': headerValue(all.referrerPolicy, 'no-referrer', defaults),
				'cross-origin-opener-policy': headerValue(
					all.crossOriginOpenerPolicy,
					'same-origin',
					defaults
				),
				'cross-origin-resource-policy': headerValue(
					all.crossOriginResourcePolicy,
					'same-origin',
					defaults
				),
				'x-frame-options': headerValue(all.xFrameOptions, 'DENY', defaults),
				'content-security-policy': all.contentSecurityPolicy || undefined
			};
			if (isHttps(request, trustProxy)) {
				values['strict-transport-security'] = headerValue(
					all.strictTransportSecurity,
					'max-age=15552000; includeSubDomains',
					defaults
				);
			}
			for (const [name, value] of Object.entries(values)) {
				if (value !== undefined) set.headers[name] = value;
			}
		}

		if (cors) {
			const origin = request.headers.get('origin');
			set.headers.vary = set.headers.vary ? `${set.headers.vary}, Origin` : 'Origin';
			if (origin && originAllowed(cors, origin, request)) {
				set.headers['access-control-allow-origin'] =
					cors.origin === '*' && !cors.credentials ? '*' : origin;
				if (cors.credentials) set.headers['access-control-allow-credentials'] = 'true';
				if (cors.exposedHeaders?.length) {
					set.headers['access-control-expose-headers'] = cors.exposedHeaders.join(', ');
				}

				const asked = request.headers.get('access-control-request-method');
				if (request.method === 'OPTIONS' && asked) {
					const preflight = new Headers(set.headers as Record<string, string>);
					preflight.set(
						'access-control-allow-methods',
						(cors.methods ?? DEFAULT_METHODS).join(', ')
					);
					const allowedHeaders =
						cors.allowedHeaders?.join(', ') ??
						request.headers.get('access-control-request-headers');
					if (allowedHeaders) preflight.set('access-control-allow-headers', allowedHeaders);
					if (cors.maxAge !== undefined)
						preflight.set('access-control-max-age', String(cors.maxAge));
					return new Response(null, { status: 204, headers: preflight });
				}
			}
		}

		if (bodyLimit !== false) {
			const length = Number(request.headers.get('content-length'));
			if (length > bodyLimit) throw new PayloadTooLargeError(bodyLimit);
		}
	});

	if (bodyLimit !== false) {
		app.onParse('global', (context) => {
			const ctx = context as unknown as { request: Request; contentType?: string };
			const { request } = ctx;
			const contentType = ctx.contentType ?? request.headers.get('content-type') ?? '';
			// A declared length was checked in onRequest; the runtime holds the body to it.
			if (!request.body || request.headers.has('content-length')) return;
			if (!LIMITED_TYPES.test(contentType)) return;
			return parseLimited(request, contentType, bodyLimit);
		});
	}
};
