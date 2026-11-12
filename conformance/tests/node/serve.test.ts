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

import type { IncomingMessage, Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { once } from 'node:events';
import { request as httpRequest } from 'node:http';

import { Application, getLogger, Http, Module, resetContainer, Runtime } from '@elysiumjs/core';
import { runtime as runtimeNode, serveNode } from '@elysiumjs/runtime-node';
import { afterEach, describe, expect, it, vi } from 'vitest';

const ABORT_TIMEOUT_MS = 2000;
const SETTLE_MS = 50;

let server: Server | undefined;

const start = async (fetch: (req: Request) => Promise<Response>): Promise<string> => {
	server = serveNode(fetch, 0);
	if (!server.listening) await once(server, 'listening');
	return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
};

afterEach(async () => {
	server?.closeAllConnections();
	await new Promise((resolve) => server?.close(resolve) ?? resolve(undefined));
	server = undefined;
});

/** Sends a GET with a raw request-target and Host header, which `fetch` would normalise. */
const rawGet = async (
	base: string,
	path: string,
	host: string
): Promise<{ status: number; body: string }> => {
	const { port } = new URL(base);
	const client = httpRequest({ host: '127.0.0.1', port, path, headers: { host } });
	client.end();
	const [response] = (await once(client, 'response')) as [IncomingMessage];
	let body = '';
	for await (const chunk of response) body += chunk;
	return { status: response.statusCode ?? 0, body };
};

const streamOf = (...chunks: string[]) =>
	new ReadableStream<Uint8Array>({
		start(controller) {
			for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
			controller.close();
		}
	});

describe('serveNode', () => {
	it('serves a streamed response and a POST body on a real port', async () => {
		const base = await start(async (req) => {
			if (req.method === 'POST') {
				const body = await req.text();
				return new Response(`echo:${body}`, { status: 201, headers: { 'x-method': req.method } });
			}
			return new Response(streamOf('hello ', 'stream'), {
				status: 200,
				headers: { 'content-type': 'text/plain', 'x-path': new URL(req.url).pathname }
			});
		});

		const streamed = await fetch(`${base}/stream?q=1`);
		expect(streamed.status).toBe(200);
		expect(streamed.headers.get('x-path')).toBe('/stream');
		expect(await streamed.text()).toBe('hello stream');

		const posted = await fetch(`${base}/echo`, {
			method: 'POST',
			body: streamOf('a', 'b', 'c'),
			duplex: 'half'
		} as RequestInit);
		expect(posted.status).toBe(201);
		expect(posted.headers.get('x-method')).toBe('POST');
		expect(await posted.text()).toBe('echo:abc');
	});

	it('forwards request headers and keeps every set-cookie header', async () => {
		const base = await start(async (req) => {
			const headers = new Headers({ 'x-seen': req.headers.get('x-client') ?? '' });
			headers.append('set-cookie', 'a=1; Path=/');
			headers.append('set-cookie', 'b=2; Path=/');
			return new Response(null, { status: 204, headers });
		});

		const response = await fetch(base, { headers: { 'x-client': 'node' } });

		expect(response.status).toBe(204);
		expect(response.headers.get('x-seen')).toBe('node');
		expect(response.headers.getSetCookie()).toEqual(['a=1; Path=/', 'b=2; Path=/']);
	});

	it('keeps the Host header authoritative over an origin-form path that starts with //', async () => {
		const base = await start(async (req) => new Response(req.url));

		const { status, body } = await rawGet(base, '//evil.example/admin?x=1', 'real.test');

		expect(status).toBe(200);
		const url = new URL(body);
		expect(url.host).toBe('real.test');
		expect(url.pathname).toBe('//evil.example/admin');
		expect(url.search).toBe('?x=1');
	});

	it('keeps only the path and query of an absolute-form target, on the Host header host', async () => {
		const base = await start(async (req) => new Response(req.url));

		const { status, body } = await rawGet(base, 'https://other.example/x?q=1', 'real.test');

		expect(status).toBe(200);
		expect(body).toBe('http://real.test/x?q=1');
	});

	it('answers 400 to a Host header that is not a bare host', async () => {
		const base = await start(async (req) => new Response(req.url));

		const { status } = await rawGet(base, '/ok', 'real.test/evil');

		expect(status).toBe(400);
	});

	it('leaves the request signal alone when the response completes', async () => {
		let signal: AbortSignal | undefined;
		const base = await start(async (req) => {
			signal = req.signal;
			return new Response(streamOf('done'));
		});

		const response = await fetch(base);
		expect(await response.text()).toBe('done');
		// The server closes its side once the body is flushed: let that settle before checking.
		await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));

		expect(signal?.aborted).toBe(false);
	});

	it('answers 500 when the handler throws', async () => {
		const base = await start(async () => {
			throw new Error('boom');
		});

		const response = await fetch(base);

		expect(response.status).toBe(500);
	});

	it('aborts the request signal when the client goes away', async () => {
		let signal: AbortSignal | undefined;
		const base = await start(async (req) => {
			signal = req.signal;
			// A stream that never ends: only a client abort stops it.
			return new Response(
				new ReadableStream({
					start(controller) {
						controller.enqueue(new TextEncoder().encode('first'));
					}
				})
			);
		});

		const client = httpRequest(base);
		client.end();
		const [response] = (await once(client, 'response')) as [IncomingMessage];
		await once(response, 'data');
		client.destroy();

		const aborted = await new Promise<boolean>((resolve) => {
			if (signal?.aborted) return resolve(true);
			const timer = setTimeout(() => resolve(false), ABORT_TIMEOUT_MS);
			signal?.addEventListener('abort', () => {
				clearTimeout(timer);
				resolve(true);
			});
		});
		expect(aborted).toBe(true);
	});

	it('logs nothing when the client goes away while the body is written', async () => {
		const errors: unknown[] = [];
		const logger = getLogger({ runtime: 'node' });
		const spy = vi.spyOn(logger, 'error').mockImplementation((...args) => void errors.push(args));
		const base = await start(
			async () =>
				new Response(
					new ReadableStream({
						async pull(controller) {
							controller.enqueue(new TextEncoder().encode('chunk'));
							await new Promise((resolve) => setTimeout(resolve, 5));
						}
					})
				)
		);

		const client = httpRequest(base);
		client.end();
		const [response] = (await once(client, 'response')) as [IncomingMessage];
		await once(response, 'data');
		client.destroy();
		await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));

		spy.mockRestore();
		expect(errors).toEqual([]);
	});

	it('closes the server through the handle runtime.serve returns', async () => {
		const app = { fetch: async () => new Response('ok') } as never;
		const handle = runtimeNode.serve(app, 0)!;
		await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));

		await handle.close();
	});

	it('serves an Elysium application end to end on Node', async () => {
		@Http.controller('/greet')
		class GreetController {
			@Http.get('/:name')
			public greet(@Http.param('name') name: string) {
				return { hello: name };
			}
		}

		@Module.register({ controllers: [GreetController] })
		class GreetModule extends Module {}

		@Application.register({ modules: [GreetModule], openapi: false })
		class GreetApp extends Application {}

		Runtime.use(runtimeNode);
		const app = new GreetApp();
		try {
			const elysia = await app.build();
			const base = await start(async (req) => elysia.fetch(req));

			const response = await fetch(`${base}/greet/node`);

			expect(response.status).toBe(200);
			expect(await response.json()).toEqual({ hello: 'node' });
		} finally {
			await app.kernel.shutdown();
			resetContainer();
		}
	});
});
