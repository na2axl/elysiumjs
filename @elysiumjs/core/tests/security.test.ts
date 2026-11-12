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

import { afterEach, describe, expect, it } from 'bun:test';

import { Application } from '../src/app';
import { Http } from '../src/http';
import { Module } from '../src/module';
import { Runtime } from '../src/runtime';
import { clientAddress, InvalidCorsOptionsError } from '../src/security';
import { createTestingHttpApp } from '../src/testing';
import { testRuntime } from './test-runtime';

let handled = 0;

@Http.controller('/s')
class SecureController {
	@Http.get()
	public show(@Http.context() c: any) {
		return { ip: c.ip ?? null };
	}

	@Http.post()
	public create(@Http.context() c: any) {
		handled++;
		return { size: JSON.stringify(c.body).length, body: c.body };
	}
}

@Module.register({ controllers: [SecureController] })
class SecureModule extends Module {}

const appWith = (http: object) => {
	@Application.register({ modules: [SecureModule], openapi: false, http })
	class SecureApp extends Application {}
	return SecureApp;
};

const chunked = (text: string, size = 16) => {
	const bytes = new TextEncoder().encode(text);
	return new ReadableStream<Uint8Array>({
		start(controller) {
			for (let i = 0; i < bytes.length; i += size) controller.enqueue(bytes.slice(i, i + size));
			controller.close();
		}
	});
};

describe('HTTP security', () => {
	let testing: Awaited<ReturnType<typeof createTestingHttpApp>> | undefined;

	afterEach(async () => {
		await testing?.shutdown();
		testing = undefined;
		handled = 0;
		Runtime.use(testRuntime);
	});

	const start = async (http: object) => {
		testing = await createTestingHttpApp({ app: appWith(http) });
		return testing.http;
	};

	describe('CORS', () => {
		const cors = {
			origin: ['https://app.test'],
			credentials: true,
			exposedHeaders: ['x-total'],
			maxAge: 600
		};

		it('answers an allowed preflight with 204 and the allowed methods', async () => {
			const http = await start({ cors });
			const response = await http
				.options('/s')
				.header('origin', 'https://app.test')
				.header('access-control-request-method', 'POST')
				.header('access-control-request-headers', 'content-type');

			expect(response.status).toBe(204);
			expect(response.headers.get('access-control-allow-origin')).toBe('https://app.test');
			expect(response.headers.get('access-control-allow-credentials')).toBe('true');
			expect(response.headers.get('access-control-allow-methods')).toContain('POST');
			expect(response.headers.get('access-control-allow-headers')).toBe('content-type');
			expect(response.headers.get('access-control-max-age')).toBe('600');
			expect(response.headers.get('vary')).toBe('Origin');
		});

		it('sets the origin on simple requests, and nothing for other origins', async () => {
			const http = await start({ cors });
			const allowed = await http.get('/s').header('origin', 'https://app.test');
			const other = await http.get('/s').header('origin', 'https://evil.test');

			expect(allowed.headers.get('access-control-allow-origin')).toBe('https://app.test');
			expect(allowed.headers.get('access-control-expose-headers')).toBe('x-total');
			expect(other.headers.get('access-control-allow-origin')).toBeNull();
			expect(other.headers.get('vary')).toBe('Origin');
		});

		it('refuses every origin with credentials', async () => {
			const error = await start({ cors: { origin: '*', credentials: true } }).catch((e) => e);
			expect(error).toBeInstanceOf(InvalidCorsOptionsError);
		});
	});

	describe('security headers', () => {
		it('sends the defaults, with HSTS only over HTTPS', async () => {
			const http = await start({ headers: true });
			const plain = await http.get('/s');

			expect(plain.headers.get('x-content-type-options')).toBe('nosniff');
			expect(plain.headers.get('referrer-policy')).toBe('no-referrer');
			expect(plain.headers.get('x-frame-options')).toBe('DENY');
			expect(plain.headers.get('content-security-policy')).toBeNull();
			expect(plain.headers.get('strict-transport-security')).toBeNull();

			const secure = await testing!.http.send(new Request('https://localhost/s'));
			expect(secure.headers.get('strict-transport-security')).toContain('max-age=');
		});

		it('sends only the chosen headers, with custom values', async () => {
			const http = await start({
				headers: { contentSecurityPolicy: "default-src 'none'", xFrameOptions: 'SAMEORIGIN' }
			});
			const response = await http.get('/s');

			expect(response.headers.get('content-security-policy')).toBe("default-src 'none'");
			expect(response.headers.get('x-frame-options')).toBe('SAMEORIGIN');
			expect(response.headers.get('referrer-policy')).toBeNull();
		});

		it('trusts x-forwarded-proto behind a trusted proxy', async () => {
			const http = await start({ headers: true, trustProxy: true });
			const response = await http.get('/s').header('x-forwarded-proto', 'https');
			expect(response.headers.get('strict-transport-security')).toContain('max-age=');
		});
	});

	describe('body limit', () => {
		it('refuses a declared length over the limit before the handler runs', async () => {
			const http = await start({ bodyLimit: 32 });
			const response = await http
				.post('/s')
				.header('content-type', 'application/json')
				.header('content-length', '1000')
				.body('{}');

			expect(response.status).toBe(413);
			expect((await response.json()).title).toBe('Request Entity Too Large');
			expect(handled).toBe(0);
		});

		it('refuses a chunked body once it goes over the limit', async () => {
			const http = await start({ bodyLimit: 32 });
			const response = await http
				.post('/s')
				.header('content-type', 'application/json')
				.body(chunked(JSON.stringify({ text: 'x'.repeat(100) })));

			expect(response.status).toBe(413);
			expect(handled).toBe(0);
		});

		it('parses a chunked body under the limit, for JSON, forms and text', async () => {
			const http = await start({ bodyLimit: 1024 });

			const json = await http
				.post('/s')
				.header('content-type', 'application/json')
				.body(chunked('{"a":1}'));
			expect((await json.json()).body).toEqual({ a: 1 });

			const form = await http
				.post('/s')
				.header('content-type', 'application/x-www-form-urlencoded')
				.body(chunked('a=1&b=2&b=3'));
			expect((await form.json()).body).toEqual({ a: '1', b: ['2', '3'] });

			const text = await http
				.post('/s')
				.header('content-type', 'text/plain')
				.body(chunked('hello'));
			expect((await text.json()).body).toBe('hello');
		});

		it('answers malformed chunked JSON with 400', async () => {
			const http = await start({});
			const response = await http
				.post('/s')
				.header('content-type', 'application/json')
				.body(chunked('{bad'));
			expect(response.status).toBe(400);
		});
	});

	describe('client address', () => {
		const request = (headers: Record<string, string> = {}) =>
			new Request('http://localhost/', { headers });

		it('uses the runtime address without trusted proxies', () => {
			Runtime.use({ ...testRuntime, clientAddress: () => '10.0.0.1' });
			expect(clientAddress(request({ 'x-forwarded-for': '1.2.3.4' }), false)).toBe('10.0.0.1');
		});

		it('takes the first hop when every proxy is trusted', () => {
			Runtime.use({ ...testRuntime, clientAddress: () => '10.0.0.1' });
			expect(clientAddress(request({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8' }), true)).toBe(
				'1.2.3.4'
			);
		});

		it('counts trusted hops from the peer', () => {
			Runtime.use({ ...testRuntime, clientAddress: () => '10.0.0.1' });
			const req = request({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8' });
			expect(clientAddress(req, 1)).toBe('5.6.7.8');
			expect(clientAddress(req, 2)).toBe('1.2.3.4');
		});

		it('walks back over a list of trusted proxies', () => {
			Runtime.use({ ...testRuntime, clientAddress: () => '10.0.0.1' });
			const req = request({ 'x-forwarded-for': '1.2.3.4, 10.0.0.2' });
			expect(clientAddress(req, ['10.0.0.1', '10.0.0.2'])).toBe('1.2.3.4');
		});

		it('exposes the address as ctx.ip', async () => {
			Runtime.use({ ...testRuntime, clientAddress: () => '10.0.0.9' });
			const http = await start({});
			expect(await (await http.get('/s')).json()).toEqual({ ip: '10.0.0.9' });
		});
	});
});
