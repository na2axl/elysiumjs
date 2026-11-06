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

import { ElysiumError } from './errors';

/**
 * Sends a request to an application and returns its response, e.g. `(r) => elysia.handle(r)` or a
 * Worker's `fetch`.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type RequestHandler = (request: Request) => Promise<Response>;

/**
 * Raised by `TestResponse.expectStatus()` when the response has another status. The message holds
 * the response body, so a failing test shows why the request failed.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class UnexpectedStatusError extends ElysiumError {
	constructor(
		public readonly expected: number,
		public readonly actual: number,
		public readonly body: string
	) {
		super(`Expected status ${expected}, got ${actual}: ${body || '(empty body)'}`);
		this.name = 'UnexpectedStatusError';
	}
}

/**
 * A response from the HTTP test client.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type TestResponse = Response & {
	/** Parses the body as JSON. */
	json<T = any>(): Promise<T>;

	/**
	 * Checks the status, and throws an {@link UnexpectedStatusError} holding the body otherwise.
	 * @returns The response itself, with its body unread.
	 */
	expectStatus(status: number): Promise<TestResponse>;
};

const toTestResponse = (response: Response): TestResponse =>
	Object.assign(response, {
		expectStatus: async (status: number): Promise<TestResponse> => {
			if (response.status !== status) {
				throw new UnexpectedStatusError(status, response.status, await response.clone().text());
			}
			return response as TestResponse;
		}
	}) as TestResponse;

/**
 * A request being built by the HTTP test client. Send it with `send()`, or await it directly.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class TestRequest implements PromiseLike<TestResponse> {
	readonly #handle: RequestHandler;
	readonly #method: string;
	readonly #url: URL;
	readonly #headers = new Headers();
	#body: BodyInit | undefined;

	constructor(handle: RequestHandler, method: string, path: string, baseUrl: string) {
		this.#handle = handle;
		this.#method = method;
		this.#url = new URL(path, baseUrl);
	}

	/** Sets a request header. */
	public header(name: string, value: string): this {
		this.#headers.set(name, value);
		return this;
	}

	/** Sets several request headers. */
	public headers(headers: Record<string, string>): this {
		for (const [name, value] of Object.entries(headers)) this.#headers.set(name, value);
		return this;
	}

	/** Adds query string parameters. Arrays add one parameter per value. */
	public query(params: Record<string, string | number | boolean | (string | number)[]>): this {
		for (const [name, value] of Object.entries(params)) {
			for (const item of Array.isArray(value) ? value : [value]) {
				this.#url.searchParams.append(name, String(item));
			}
		}
		return this;
	}

	/** Sends a JSON body, with `content-type: application/json`. */
	public json(body: unknown): this {
		this.#body = JSON.stringify(body);
		if (!this.#headers.has('content-type')) this.#headers.set('content-type', 'application/json');
		return this;
	}

	/** Sends a URL-encoded form body. */
	public form(fields: Record<string, string>): this {
		this.#body = new URLSearchParams(fields);
		return this;
	}

	/** Sends a raw body: a string, bytes, a stream, `FormData` or `URLSearchParams`. */
	public body(body: BodyInit): this {
		this.#body = body;
		return this;
	}

	/** Builds the `Request` this builder describes, without sending it. */
	public toRequest(): Request {
		const init: RequestInit & { duplex?: 'half' } = {
			method: this.#method,
			headers: this.#headers,
			body: this.#body
		};
		if (this.#body instanceof ReadableStream) init.duplex = 'half';
		return new Request(this.#url, init);
	}

	/** Sends the request. */
	public async send(): Promise<TestResponse> {
		return toTestResponse(await this.#handle(this.toRequest()));
	}

	public then<TResult1 = TestResponse, TResult2 = never>(
		onfulfilled?: ((value: TestResponse) => TResult1 | PromiseLike<TResult1>) | null,
		onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
	): Promise<TResult1 | TResult2> {
		return this.send().then(onfulfilled, onrejected);
	}
}

/**
 * An HTTP client that drives an application in memory, without a server.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type HttpTestClient = {
	get(path: string): TestRequest;
	post(path: string): TestRequest;
	put(path: string): TestRequest;
	patch(path: string): TestRequest;
	delete(path: string): TestRequest;
	head(path: string): TestRequest;
	options(path: string): TestRequest;
	/** Starts a request with any method. */
	request(method: string, path: string): TestRequest;
	/** Sends a prebuilt `Request` as is. */
	send(request: Request): Promise<TestResponse>;
};

/**
 * Creates an HTTP test client on top of a request handler.
 * @author Axel Nana <axel.nana@workbud.com>
 * @param handle Sends a request to the application, e.g. `(r) => elysia.handle(r)`.
 * @param baseUrl The origin relative paths resolve against. Defaults to `http://localhost`.
 */
export const createHttpClient = (
	handle: RequestHandler,
	baseUrl = 'http://localhost'
): HttpTestClient => {
	const request = (method: string, path: string) => new TestRequest(handle, method, path, baseUrl);
	return {
		get: (path) => request('GET', path),
		post: (path) => request('POST', path),
		put: (path) => request('PUT', path),
		patch: (path) => request('PATCH', path),
		delete: (path) => request('DELETE', path),
		head: (path) => request('HEAD', path),
		options: (path) => request('OPTIONS', path),
		request,
		send: async (req) => toTestResponse(await handle(req))
	};
};
