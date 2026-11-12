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

import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import type { TLSSocket } from 'node:tls';

import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { getLogger } from '@elysiumjs/core';

/**
 * A web-standard request handler, such as `Elysia.fetch`.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type FetchHandler = (request: Request) => Promise<Response>;

const BODYLESS_METHODS = new Set(['GET', 'HEAD']);
const STATUS_BAD_REQUEST = 400;
const STATUS_INTERNAL_ERROR = 500;

/** Copies the raw request headers, keeping repeated ones. */
const toHeaders = (raw: readonly string[]): Headers => {
	const headers = new Headers();
	for (let i = 0; i + 1 < raw.length; i += 2) headers.append(raw[i]!, raw[i + 1]!);
	return headers;
};

/**
 * The path and query of a request-target. An origin-form target (`/a`, also `//a/b`) is kept as
 * is, a literal path. An absolute-form target (`http://other/a`) only gives its path and query:
 * the `Host` header always names the host, so the target can never redirect a request to another.
 */
const pathOf = (target: string): string => {
	if (target.startsWith('/')) return target;
	try {
		const absolute = new URL(target);
		if (absolute.protocol === 'http:' || absolute.protocol === 'https:') {
			return `${absolute.pathname}${absolute.search}`;
		}
	} catch {
		// Not a URL either: reported below.
	}
	throw new TypeError(`Unsupported request-target: ${target}`);
};

/** Builds the absolute URL of a request: the `Host` header's origin, then the target's path. */
const toUrl = (req: IncomingMessage): URL => {
	const protocol = (req.socket as TLSSocket).encrypted ? 'https' : 'http';
	const host = req.headers.host ?? 'localhost';
	let origin: URL;
	try {
		origin = new URL(`${protocol}://${host}`);
	} catch {
		throw new TypeError(`Invalid Host header: ${host}`);
	}
	const bare = origin.pathname === '/' && !origin.search && !origin.hash;
	if (!bare || origin.username || origin.password) {
		throw new TypeError(`Invalid Host header: ${host}`);
	}
	// Concatenated, not resolved against the origin: `//x/y` stays a path on this host.
	return new URL(`${origin.origin}${pathOf(req.url ?? '/')}`);
};

/** The address of the peer that sent each request served by the bridge. */
const peers = new WeakMap<Request, string>();

/**
 * The address of the peer that sent a request served by {@link serveNode}.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @param request A request created by the bridge.
 */
export const peerAddress = (request: Request): string | undefined => peers.get(request);

/** Converts a Node request to a web `Request` whose body streams from the socket. */
const toRequest = (req: IncomingMessage, url: URL, signal: AbortSignal): Request => {
	const method = req.method ?? 'GET';
	const body = BODYLESS_METHODS.has(method)
		? {}
		: { body: Readable.toWeb(req) as unknown as ReadableStream<Uint8Array>, duplex: 'half' };
	const request = new Request(url, { method, headers: toHeaders(req.rawHeaders), signal, ...body });
	if (req.socket.remoteAddress) peers.set(request, req.socket.remoteAddress);
	return request;
};

/** Writes the status, the headers (each `set-cookie` apart) and the streamed body. */
const writeResponse = async (response: Response, res: ServerResponse): Promise<void> => {
	res.statusCode = response.status;
	if (response.statusText) res.statusMessage = response.statusText;
	for (const [name, value] of response.headers) {
		if (name !== 'set-cookie') res.setHeader(name, value);
	}
	const cookies = response.headers.getSetCookie();
	if (cookies.length > 0) res.setHeader('set-cookie', cookies);

	if (!response.body) {
		res.end();
		return;
	}
	// The global and `node:stream/web` stream types differ in their declarations only.
	await pipeline(Readable.fromWeb(response.body as unknown as NodeReadableStream), res);
};

/** Ends a response that failed: a 500 when nothing was sent yet, a dropped socket otherwise. */
const fail = (res: ServerResponse, status: number): void => {
	if (res.headersSent) {
		res.destroy();
		return;
	}
	res.writeHead(status).end();
};

const ABORT_ERROR_CODES = new Set(['ABORT_ERR', 'ERR_STREAM_PREMATURE_CLOSE']);

/** Whether an error only reports that the stream was cut short by an abort. */
const isAbortError = (error: unknown): boolean =>
	error instanceof Error &&
	(error.name === 'AbortError' ||
		ABORT_ERROR_CODES.has((error as NodeJS.ErrnoException).code ?? ''));

const handle = async (
	fetch: FetchHandler,
	req: IncomingMessage,
	res: ServerResponse
): Promise<void> => {
	const controller = new AbortController();
	// The client went away before the response was fully written.
	res.once('close', () => {
		if (!res.writableFinished) controller.abort();
	});

	let url: URL;
	try {
		url = toUrl(req);
	} catch {
		// Every failure to form the URL comes from the client's Host header or request-target.
		fail(res, STATUS_BAD_REQUEST);
		return;
	}

	try {
		await writeResponse(await fetch(toRequest(req, url, controller.signal)), res);
	} catch (error) {
		// The client went away: an abort ended the body stream early, or the socket is already
		// destroyed. There is nothing left to answer.
		if ((controller.signal.aborted && isAbortError(error)) || res.destroyed || req.destroyed) {
			return;
		}
		getLogger({ runtime: 'node' }).error('Failed to serve a request', {
			method: req.method,
			url: url.href,
			error
		});
		fail(res, STATUS_INTERNAL_ERROR);
	}
};

/**
 * Serves a web-standard fetch handler on a `node:http` server. Request bodies stream from the
 * socket (`Readable.toWeb`, `duplex: 'half'`), response bodies stream to it, status and headers
 * are copied (every `set-cookie` header is kept), and the request `signal` aborts when the client
 * disconnects before the response is complete.
 *
 * The `Host` header always names the request's host: an origin-form target such as `//x/y` is a
 * path on that host, and an absolute-form target (`GET http://other/a`) only contributes its path
 * and query. A `Host` header that is not a bare host, or a target that is neither form, gets a 400.
 *
 * This bridge exists because no Elysia 2 Node adapter is released yet (`@elysia/node` only has
 * `2.0.0-exp.*` builds, and `@elysiajs/node` targets Elysia 1).
 * @author Axel Nana <ax.lnana@outlook.com>
 * @param fetch The handler that answers each request, such as `(r) => app.fetch(r)`.
 * @param port The port to listen on; `0` picks a free one (read it from `server.address()`).
 * @returns The listening server, to close it.
 */
export const serveNode = (fetch: FetchHandler, port: number): Server =>
	createServer((req, res) => void handle(fetch, req, res)).listen(port);
