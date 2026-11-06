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

import type { Scenario } from './types';

import { Application, Http, Module } from '@elysiumjs/core';
import { t } from 'elysia';

const make = async (): Promise<Application> => {
	@Http.controller({ path: '/s' })
	class SecurityController {
		@Http.post({ path: '/echo' })
		public echo(@Http.body(t.Object({ text: t.String() })) body: { text: string }) {
			return body;
		}
	}

	@Module.register({ controllers: [SecurityController] })
	class SecurityModule extends Module {}

	@Application.register({
		modules: [SecurityModule],
		openapi: false,
		http: {
			bodyLimit: 64,
			headers: true,
			cors: { origin: ['https://app.example.com'], maxAge: 600 }
		}
	})
	class SecurityApp extends Application {}

	return new SecurityApp();
};

/** A JSON body sent in chunks, without a content-length, so the limit is counted while reading. */
const chunked = (size: number) => {
	const json = JSON.stringify({ text: 'x'.repeat(size) });
	const bytes = new TextEncoder().encode(json);
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			for (let i = 0; i < bytes.length; i += 16) controller.enqueue(bytes.slice(i, i + 16));
			controller.close();
		}
	});
	return new Request('http://localhost/s/echo', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body,
		// @ts-expect-error `duplex` is required for streamed bodies on Node and not typed everywhere.
		duplex: 'half'
	});
};

/**
 * The HTTP options hold on every runtime: security headers, CORS preflights, and the body limit,
 * also for chunked bodies with no content-length.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export const security: Scenario = {
	name: 'security: headers, CORS and body limits',
	app: make,
	requests: [
		{
			request: () =>
				new Request('http://localhost/s/echo', {
					method: 'POST',
					headers: { 'content-type': 'application/json', origin: 'https://app.example.com' },
					body: JSON.stringify({ text: 'hi' })
				}),
			expect: {
				status: 200,
				json: { text: 'hi' },
				headers: {
					'x-content-type-options': 'nosniff',
					'x-frame-options': 'DENY',
					'access-control-allow-origin': 'https://app.example.com',
					vary: 'Origin'
				}
			}
		},
		{
			request: () =>
				new Request('http://localhost/s/echo', {
					method: 'OPTIONS',
					headers: {
						origin: 'https://app.example.com',
						'access-control-request-method': 'POST'
					}
				}),
			expect: {
				status: 204,
				headers: {
					'access-control-allow-origin': 'https://app.example.com',
					'access-control-max-age': '600'
				}
			}
		},
		{
			request: () =>
				new Request('http://localhost/s/echo', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ text: 'x'.repeat(100) })
				}),
			expect: { status: 413, headers: { 'content-type': 'application/problem+json' } }
		},
		{
			request: () => chunked(100),
			expect: { status: 413, headers: { 'content-type': 'application/problem+json' } }
		},
		{
			request: () => chunked(10),
			expect: { status: 200, json: { text: 'x'.repeat(10) } }
		}
	]
};
