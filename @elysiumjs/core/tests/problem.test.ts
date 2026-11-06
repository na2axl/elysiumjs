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

import { afterEach, describe, expect, it } from 'bun:test';
import { t } from 'elysia';

import { Application } from '../src/app';
import { Event } from '../src/event';
import { Http } from '../src/http';
import { Middleware } from '../src/middleware';
import { Module } from '../src/module';
import {
	DomainError,
	isProblemDetails,
	PROBLEM_CONTENT_TYPE,
	statusTitle,
	toProblem,
	validationErrors
} from '../src/problem';
import { createTestingHttpApp } from '../src/testing';

class InsufficientFundsError extends DomainError {
	constructor(balance: number) {
		super({
			status: 409,
			type: 'insufficient-funds',
			title: 'Insufficient funds',
			detail: `The balance is ${balance}.`,
			extensions: { balance }
		});
	}
}

describe('toProblem', () => {
	const context = { path: '/x', development: false };

	it('keeps the fields of a DomainError and prefixes a relative type', () => {
		const problem = toProblem(new InsufficientFundsError(3), {
			...context,
			typeBase: 'https://api.test/problems'
		});
		expect(problem).toEqual({
			type: 'https://api.test/problems/insufficient-funds',
			title: 'Insufficient funds',
			status: 409,
			detail: 'The balance is 3.',
			instance: '/x',
			balance: 3
		});
	});

	it('keeps absolute types and about:blank as they are', () => {
		const absolute = new DomainError({ status: 400, type: 'urn:problem:x' });
		expect(toProblem(absolute, { ...context, typeBase: 'https://a/' }).type).toBe('urn:problem:x');
		expect(toProblem(DomainError.notFound(), { ...context, typeBase: 'https://a/' }).type).toBe(
			'about:blank'
		);
	});

	it('does not let extensions replace the standard members', () => {
		const error = new DomainError({ status: 409, extensions: { status: 200, title: 'x' } });
		expect(toProblem(error, context)).toMatchObject({ status: 409, title: 'Conflict' });
	});

	it('hides the detail of server errors outside development, and shows it in development', () => {
		const error = new Error('secret table name');
		expect(toProblem(error, context)).toEqual({
			type: 'about:blank',
			title: 'Internal Server Error',
			status: 500,
			instance: '/x'
		});
		const dev = toProblem(error, { ...context, development: true });
		expect(dev.detail).toBe('secret table name');
		expect(Array.isArray(dev.stack)).toBe(true);
	});

	it('maps validator errors to JSON pointers, one per missing property', () => {
		const errors = validationErrors('body', [
			{
				path: 'root',
				message: 'must have required properties age',
				params: { requiredProperties: ['age', 'a/b'] }
			},
			{ path: 'email', message: 'must match format "email"', params: { format: 'email' } },
			{ instancePath: '/items/0/name', message: 'must be string', keyword: 'type' }
		]);
		expect(errors).toEqual([
			{ pointer: '/body/age', message: 'is required', code: 'requiredProperties' },
			{ pointer: '/body/a~1b', message: 'is required', code: 'requiredProperties' },
			{ pointer: '/body/email', message: 'must match format "email"', code: 'format' },
			{ pointer: '/body/items/0/name', message: 'must be string', code: 'type' }
		]);
	});

	it('names the standard status titles', () => {
		expect(statusTitle(404)).toBe('Not Found');
		expect(statusTitle(418)).toBe("I'm a teapot");
		expect(statusTitle(499)).toBe('Client Error');
		expect(statusTitle(599)).toBe('Server Error');
	});

	it('recognises problem details objects', () => {
		expect(isProblemDetails({ type: 'about:blank', title: 'Gone', status: 410 })).toBe(true);
		expect(isProblemDetails({ status: 410 })).toBe(false);
		expect(isProblemDetails(null)).toBe(false);
	});
});

describe('problem details over HTTP', () => {
	let testing: Awaited<ReturnType<typeof createTestingHttpApp>> | undefined;
	let reported: unknown[] = [];

	afterEach(async () => {
		await testing?.shutdown();
		testing = undefined;
		reported = [];
		Event.off('elysium:error');
	});

	class Stop extends Middleware {
		public onBeforeHandle() {
			return { stopped: true };
		}
	}

	const seenErrors: unknown[] = [];

	/** Sees the error of a failed request, and sets a header on its response. */
	class Witness extends Middleware {
		public onError(c: { error: unknown; set: { headers: Record<string, string> } }) {
			seenErrors.push(c.error);
			c.set.headers['x-witness'] = 'seen';
		}
	}

	class EvenBody {
		static readonly schema = t.Object({ n: t.Number() });
		static async authorize() {
			return true;
		}
		static async validate(c: { body: { n: number } }) {
			return c.body.n % 2 === 0;
		}
	}

	@Http.controller({ path: '/p' })
	class ProblemController {
		@Http.post({ path: '/even' })
		public even(@Http.body(EvenBody as never) body: unknown) {
			return body;
		}

		@Middleware.register(Witness)
		@Http.get({ path: '/witnessed' })
		public witnessed() {
			throw DomainError.conflict('no');
		}

		@Http.get({ path: '/domain' })
		public domain() {
			throw new InsufficientFundsError(5);
		}

		@Http.get({ path: '/status' })
		public status(@Http.context() c: any) {
			throw c.status(404, 'nope');
		}

		@Http.get({ path: '/boom' })
		public boom() {
			throw new Error('boom');
		}

		@Middleware.register(Stop)
		@Http.get({ path: '/stopped' })
		public stopped() {
			return { stopped: false };
		}

		@Http.post({ path: '/signup' })
		public signup(
			@Http.body(t.Object({ email: t.String({ format: 'email' }), age: t.Number() })) body: unknown
		) {
			return body;
		}
	}

	@Module.register({ controllers: [ProblemController] })
	class ProblemModule extends Module {}

	const makeApp = (problems?: { validationStatus?: 400 | 422; typeBase?: string }) => {
		@Application.register({ modules: [ProblemModule], openapi: false, problems })
		class ProblemApp extends Application {
			protected async onError(e: any): Promise<boolean> {
				reported.push(e.error);
				return true;
			}
		}
		return ProblemApp;
	};

	const start = async (problems?: { validationStatus?: 400 | 422; typeBase?: string }) => {
		const listener = (e: unknown) => reported.push(['event', e]);
		Event.on('elysium:error', listener);
		testing = await createTestingHttpApp({ app: makeApp(problems) });
		return testing.http;
	};

	it('renders a DomainError as problem details, without reporting it', async () => {
		const http = await start({ typeBase: 'https://api.test/problems/' });
		const response = await http.get('/p/domain');

		expect(response.status).toBe(409);
		expect(response.headers.get('content-type')).toBe(PROBLEM_CONTENT_TYPE);
		expect(await response.json()).toEqual({
			type: 'https://api.test/problems/insufficient-funds',
			title: 'Insufficient funds',
			status: 409,
			detail: 'The balance is 5.',
			instance: '/p/domain',
			balance: 5
		});
		expect(reported).toEqual([]);
	});

	it('sends a thrown client status as is, without reporting it', async () => {
		const http = await start();
		const response = await http.get('/p/status');

		expect(response.status).toBe(404);
		expect(await response.text()).toBe('nope');
		expect(reported).toEqual([]);
	});

	it('sends the value of a middleware that stopped the request, without reporting it', async () => {
		const http = await start();
		const response = await http.get('/p/stopped');

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ stopped: true });
		expect(reported).toEqual([]);
	});

	it('reports an unexpected error once and hides its detail outside development', async () => {
		const http = await start();
		const response = await http.get('/p/boom');

		expect(response.status).toBe(500);
		expect(await response.json()).toEqual({
			type: 'about:blank',
			title: 'Internal Server Error',
			status: 500,
			instance: '/p/boom'
		});
		expect(reported.filter((r) => r instanceof Error)).toHaveLength(1);
	});

	it('lists every invalid value of a validation error, with 422 by default', async () => {
		const http = await start();
		const response = await http.post('/p/signup').json({ email: 'nope' });

		expect(response.status).toBe(422);
		expect(await response.json()).toEqual({
			type: 'about:blank',
			title: 'Unprocessable Entity',
			status: 422,
			detail: 'The request body is invalid.',
			instance: '/p/signup',
			errors: [
				{ pointer: '/body/age', message: 'is required', code: 'requiredProperties' },
				{ pointer: '/body/email', message: 'must match format "email"', code: 'format' }
			]
		});
		expect(reported).toEqual([]);
	});

	it('uses 400 for validation errors when configured', async () => {
		const http = await start({ validationStatus: 400 });
		const response = await http.post('/p/signup').json({ email: 'a@b.co', age: 'x' });
		expect(response.status).toBe(400);
		expect((await response.json()).title).toBe('Bad Request');
	});

	it('renders unknown routes and unparsable bodies as client problems', async () => {
		const http = await start();

		const missing = await http.get('/nowhere');
		expect(missing.status).toBe(404);
		expect(await missing.json()).toMatchObject({ title: 'Not Found', instance: '/nowhere' });

		const unparsable = await http
			.post('/p/signup')
			.header('content-type', 'application/json')
			.body('{bad');
		expect(unparsable.status).toBe(400);
		expect(reported).toEqual([]);
	});

	it('answers a problem when a custom validator refuses the body', async () => {
		const http = await start();
		const refused = await http.post('/p/even').json({ n: 3 });
		expect(refused.status).toBe(400);
		expect(refused.headers.get('content-type')).toBe(PROBLEM_CONTENT_TYPE);
		expect((await refused.json()).detail).toBe('The request body is invalid.');
		expect((await http.post('/p/even').json({ n: 4 })).status).toBe(200);
	});

	it('runs the onError middlewares of a failed request before its problem is built', async () => {
		const http = await start();
		const response = await http.get('/p/witnessed');
		expect(response.status).toBe(409);
		expect(response.headers.get('x-witness')).toBe('seen');
		expect(seenErrors).toHaveLength(1);
		expect((await http.get('/p/domain')).headers.get('x-witness')).toBeNull();
	});
});
