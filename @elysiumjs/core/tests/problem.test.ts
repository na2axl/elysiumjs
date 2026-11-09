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
import { Http } from '../src/http';
import { Lifecycle } from '../src/lifecycle';
import { Middleware } from '../src/middleware';
import { Module } from '../src/module';
import {
	ConflictError,
	DomainError,
	isDomainError,
	isProblemDetails,
	PROBLEM_CONTENT_TYPE,
	problemType,
	statusTitle,
	toProblem,
	validationErrors,
	ValidationFailedError
} from '../src/problem';
import { createTestingHttpApp } from '../src/testing';

class InsufficientFundsError extends DomainError.for('INSUFFICIENT_FUNDS', 409) {
	constructor(balance: number) {
		super(`The balance is ${balance}.`, {
			title: 'Insufficient funds',
			extensions: { balance }
		});
	}
}

describe('toProblem', () => {
	const context = { path: '/x', requestId: 'req-1', development: false };

	it('keeps the members of a DomainError, with its code under the type base', () => {
		const problem = toProblem(new InsufficientFundsError(3), {
			...context,
			typeBase: 'https://api.test/problems/'
		});
		expect(problem).toEqual({
			type: 'https://api.test/problems/insufficient-funds',
			title: 'Insufficient funds',
			status: 409,
			code: 'INSUFFICIENT_FUNDS',
			detail: 'The balance is 3.',
			balance: 3,
			requestId: 'req-1',
			instance: '/x'
		});
		expect(toProblem(new InsufficientFundsError(3), context).type).toBe('insufficient-funds');
	});

	it('serves errors and retryAfter, and sets Retry-After', () => {
		const error = new ValidationFailedError([{ pointer: '/body/a', message: 'is required' }]);
		expect(toProblem(error, context)).toMatchObject({
			status: 422,
			code: 'VALIDATION_FAILED',
			errors: [{ pointer: '/body/a', message: 'is required' }]
		});
		class Slow extends DomainError.for('RATE_LIMITED', 429) {}
		const slow = new Slow('later', { retryAfterSeconds: 30 });
		expect(slow.headers).toEqual({ 'retry-after': '30' });
		expect(toProblem(slow, context)).toMatchObject({ retryAfter: 30, detail: 'later' });
	});

	it('keeps the code and status of each error class as literal types', () => {
		const error = new InsufficientFundsError(1);
		const code: 'INSUFFICIENT_FUNDS' = error.code;
		const status: 409 = error.status;
		expect([code, status]).toEqual(['INSUFFICIENT_FUNDS', 409]);
		expect(error).toBeInstanceOf(DomainError);
		expect(isDomainError(error)).toBe(true);
		expect(error.message).toBe('The balance is 1.');
		expect(problemType('FLOW_UNEXPECTED_STEP', 'https://a/b/')).toBe(
			'https://a/b/flow-unexpected-step'
		);
	});

	it('does not let extensions replace the standard members', () => {
		const error = new ConflictError('no', { extensions: { status: 200, code: 'X', type: 'y' } });
		expect(toProblem(error, context)).toMatchObject({
			status: 409,
			title: 'Conflict',
			code: 'CONFLICT',
			type: 'conflict'
		});
	});

	it('hides the detail of server errors outside development, and shows it in development', () => {
		const error = new Error('secret table name');
		expect(toProblem(error, context)).toEqual({
			type: 'internal-error',
			title: 'Internal Server Error',
			status: 500,
			code: 'INTERNAL_ERROR',
			requestId: 'req-1',
			instance: '/x'
		});
		const dev = toProblem(error, { ...context, development: true });
		expect(dev.detail).toBe('secret table name');
		expect(Array.isArray(dev.stack)).toBe(true);

		class Unavailable extends DomainError.for('UNAVAILABLE', 503) {}
		expect(toProblem(new Unavailable('db host down'), context).detail).toBeUndefined();
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
		expect(isProblemDetails({ type: 'gone', title: 'Gone', status: 410 })).toBe(true);
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
		Lifecycle.off('elysium:error');
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

	class PositiveBody {
		static readonly schema = t.Object({ n: t.Number() });
		static async authorize(c: { headers: Record<string, string | undefined> }) {
			return c.headers['x-blocked'] ? new ConflictError('blocked') : true;
		}
		static async validate(c: { body: { n: number } }) {
			return c.body.n > 0 || new InsufficientFundsError(c.body.n);
		}
	}

	@Http.controller('/p')
	class ProblemController {
		@Http.post('/positive')
		public positive(@Http.body(PositiveBody as never) body: unknown) {
			return body;
		}

		@Http.post('/even')
		public even(@Http.body(EvenBody as never) body: unknown) {
			return body;
		}

		@Middleware.register(Witness)
		@Http.get('/witnessed')
		public witnessed() {
			throw new ConflictError('no');
		}

		@Http.get('/domain')
		public domain() {
			throw new InsufficientFundsError(5);
		}

		@Http.get('/returned')
		public returned(): { paid: true } | InsufficientFundsError {
			return new InsufficientFundsError(2);
		}

		@Http.get('/status')
		public status(@Http.context() c: any) {
			throw c.status(404, 'nope');
		}

		@Http.get('/boom')
		public boom() {
			throw new Error('boom');
		}

		@Middleware.register(Stop)
		@Http.get('/stopped')
		public stopped() {
			return { stopped: false };
		}

		@Http.post('/signup')
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
		Lifecycle.on('elysium:error', listener);
		testing = await createTestingHttpApp({ app: makeApp(problems) });
		return testing.http;
	};

	it('renders a DomainError as problem details, without reporting it', async () => {
		const http = await start({ typeBase: 'https://api.test/problems/' });
		const response = await http.get('/p/domain').header('x-request-id', 'req-9');

		expect(response.status).toBe(409);
		expect(response.headers.get('content-type')).toBe(PROBLEM_CONTENT_TYPE);
		expect(await response.json()).toEqual({
			type: 'https://api.test/problems/insufficient-funds',
			title: 'Insufficient funds',
			status: 409,
			code: 'INSUFFICIENT_FUNDS',
			detail: 'The balance is 5.',
			balance: 5,
			requestId: 'req-9',
			instance: '/p/domain'
		});
		expect(reported).toEqual([]);
	});

	it('sends a returned DomainError like a thrown one, with a request id of its own', async () => {
		const http = await start();
		const response = await http.get('/p/returned').header('x-request-id', 'not a valid id!');

		expect(response.status).toBe(409);
		const body = await response.json();
		expect(body).toMatchObject({ code: 'INSUFFICIENT_FUNDS', detail: 'The balance is 2.' });
		expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/);
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

	it('reports an unexpected error once and shows its detail in test', async () => {
		const http = await start();
		const response = await http.get('/p/boom');

		expect(response.status).toBe(500);
		const body = await response.json();
		expect(body).toMatchObject({
			type: 'internal-error',
			title: 'Internal Server Error',
			status: 500,
			code: 'INTERNAL_ERROR',
			detail: 'boom',
			instance: '/p/boom'
		});
		expect(Array.isArray(body.stack)).toBe(true);
		expect(reported.filter((r) => r instanceof Error)).toHaveLength(1);
	});

	it('lists every invalid value of a validation error, with 422 by default', async () => {
		const http = await start();
		const response = await http.post('/p/signup').json({ email: 'nope' });

		expect(response.status).toBe(422);
		expect(await response.json()).toMatchObject({
			type: 'validation-failed',
			title: 'Unprocessable Entity',
			status: 422,
			code: 'VALIDATION_FAILED',
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

	it('answers the DomainError a custom validator returns', async () => {
		const http = await start();
		const refused = await http.post('/p/positive').json({ n: -1 });
		expect(refused.status).toBe(409);
		expect(refused.headers.get('content-type')).toBe(PROBLEM_CONTENT_TYPE);
		expect(await refused.json()).toMatchObject({
			code: 'INSUFFICIENT_FUNDS',
			detail: 'The balance is -1.',
			balance: -1
		});
		expect((await http.post('/p/positive').json({ n: 1 })).status).toBe(200);
	});

	it('answers the DomainError a custom validator returns from authorize', async () => {
		const http = await start();
		const refused = await http.post('/p/positive').header('x-blocked', '1').json({ n: 1 });
		expect(refused.status).toBe(409);
		expect(refused.headers.get('content-type')).toBe(PROBLEM_CONTENT_TYPE);
		expect((await refused.json()).code).toBe('CONFLICT');
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
