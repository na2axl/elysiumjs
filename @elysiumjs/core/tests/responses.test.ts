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

import type { TSchema } from 'typebox';
import type { Context } from '../src/http';

import { afterEach, describe, expect, it } from 'bun:test';
import { t } from 'elysia';

import { Application } from '../src/app';
import { Http } from '../src/http';
import { TransformInterceptor } from '../src/interceptor';
import { Middleware } from '../src/middleware';
import { Module } from '../src/module';
import {
	ConflictError,
	DomainError,
	ForbiddenError,
	InternalError,
	UnauthenticatedError,
	ValidationFailedError
} from '../src/problem';
import { RateLimit } from '../src/rate-limit';
import { createTestingHttpApp } from '../src/testing';

class InsufficientFunds extends DomainError.for('INSUFFICIENT_FUNDS', 409, {
	extensions: { missing: t.Integer() },
	description: 'The wallet holds less than the amount.'
}) {
	constructor(missing: number) {
		super(`${missing} more are needed.`, { extensions: { missing } });
	}
}

class WalletClosed extends DomainError.for('WALLET_CLOSED', 409) {}

class SignedInMiddleware extends Middleware {
	public static readonly errors = [UnauthenticatedError];

	public override onBeforeHandle(context: Context) {
		if (!context.request.headers.get('authorization')) throw new UnauthenticatedError();
	}
}

const Wallet = t.Object({ id: t.String(), balance: t.Integer() });

/** Wraps results in `{ data }`, and leaves schemas that already are. */
const enveloped = (schema: TSchema): TSchema =>
	(schema as { properties?: Record<string, unknown> }).properties?.data
		? schema
		: t.Object({ data: schema });

const Envelope = TransformInterceptor.with(
	(result: unknown) =>
		typeof result === 'object' && result !== null && 'data' in result ? result : { data: result },
	{ schema: enveloped }
);

@Http.controller('/wallets', { interceptors: [Envelope] })
class WalletController {
	@Http.post('/:id/pay', { response: Wallet, errors: [InsufficientFunds, WalletClosed] })
	public pay(
		@Http.param('id') id: string,
		@Http.body(t.Object({ amount: t.Integer() })) body: any
	) {
		if (body.amount > 100) return new InsufficientFunds(body.amount - 100);
		return { id, balance: 100 - body.amount, secret: 'stripped' };
	}

	@Http.get('/:id', { response: Wallet })
	@Middleware.register(SignedInMiddleware)
	@RateLimit({ window: 60, max: 10 })
	public show(@Http.param('id') id: string) {
		return { id, balance: 7 };
	}

	@Http.get('/', { response: { 200: t.Object({ data: t.Array(Wallet) }) } })
	public list() {
		return { data: [{ id: 'w1', balance: 1 }] };
	}

	@Http.del('/:id', { errors: [ConflictError, ForbiddenError], response: { 409: t.String() } })
	public close() {}
}

@Module.register({ controllers: [WalletController] })
class WalletModule extends Module {}

@Application.register({ modules: [WalletModule], openapi: {} })
class WalletApp extends Application {}

describe('problem classes', () => {
	it('keep their code and status as static members', () => {
		expect(InsufficientFunds.code).toBe('INSUFFICIENT_FUNDS');
		expect(InsufficientFunds.status).toBe(409);
		const code: 'INSUFFICIENT_FUNDS' = InsufficientFunds.code;
		const status: 409 = InsufficientFunds.status;
		expect([code, status]).toEqual(['INSUFFICIENT_FUNDS', 409]);
	});

	it('describe their problem with literal code and status, and their extensions', () => {
		const schema = InsufficientFunds.schema as any;

		expect(schema.properties.code.const).toBe('INSUFFICIENT_FUNDS');
		expect(schema.properties.status.const).toBe(409);
		expect(schema.properties.missing.type).toBe('integer');
		expect(schema.required).toEqual(expect.arrayContaining(['type', 'title', 'code', 'status']));
		expect(schema.description).toBe('The wallet holds less than the amount.');
		expect(InsufficientFunds.schema).toBe(InsufficientFunds.schema);
	});

	it('list invalid values in the schema of validation problems', () => {
		const schema = ValidationFailedError.schema as any;
		expect(schema.properties.errors.items.properties.pointer.type).toBe('string');
	});

	it('type the extensions of their constructor from their schemas', () => {
		class Late extends DomainError.for('LATE', 409, { extensions: { days: t.Integer() } }) {}
		const error = new Late('Too late.', { extensions: { days: 3 } });
		expect(error.extensions).toEqual({ days: 3 });

		// @ts-expect-error - `days` is an integer.
		new Late('Too late.', { extensions: { days: 'three' } });
	});
});

describe('route responses', () => {
	let testing: Awaited<ReturnType<typeof createTestingHttpApp>> | undefined;

	afterEach(async () => {
		await testing?.shutdown();
		testing = undefined;
	});

	const document = async () => {
		testing = await createTestingHttpApp({ app: WalletApp });
		const response = await testing.http.get('/openapi/json').send();
		return ((await response.json()) as any).paths;
	};

	it('documents the success schema as the interceptors make it', async () => {
		const paths = await document();
		const ok = paths['/wallets/{id}/pay'].post.responses['200'].content['application/json'].schema;

		expect(Object.keys(ok.properties)).toEqual(['data']);
		expect(Object.keys(ok.properties.data.properties)).toEqual(['id', 'balance']);
	});

	it('leaves a success schema the interceptor already describes', async () => {
		const paths = await document();
		const ok = (paths['/wallets'] ?? paths['/wallets/']).get.responses['200'].content[
			'application/json'
		].schema;

		expect(Object.keys(ok.properties)).toEqual(['data']);
		expect(ok.properties.data.type).toBe('array');
	});

	it('serializes the result through the schema of what the client receives', async () => {
		testing = await createTestingHttpApp({ app: WalletApp });
		const response = await testing.http.post('/wallets/w1/pay').json({ amount: 30 }).send();

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ data: { id: 'w1', balance: 70 } });
	});

	it('still answers a returned problem', async () => {
		testing = await createTestingHttpApp({ app: WalletApp });
		const response = await testing.http.post('/wallets/w1/pay').json({ amount: 130 }).send();

		expect(response.status).toBe(409);
		expect(await response.json()).toMatchObject({ code: 'INSUFFICIENT_FUNDS', missing: 30 });
	});

	it('documents the problems of a route, one union per status, with those of the framework', async () => {
		const paths = await document();
		const responses = paths['/wallets/{id}/pay'].post.responses;

		expect(Object.keys(responses)).toEqual(['200', '400', '409', '413', '422', '500']);
		const conflicts = responses['409'].content['application/json'].schema.anyOf;
		expect(conflicts.map((schema: any) => schema.properties.code.const)).toEqual([
			'INSUFFICIENT_FUNDS',
			'WALLET_CLOSED'
		]);
		const code = (status: string) =>
			responses[status].content['application/json'].schema.properties.code.const;
		expect(code('400')).toBe('BAD_REQUEST');
		expect(code('413')).toBe('PAYLOAD_TOO_LARGE');
		expect(code('422')).toBe('VALIDATION_FAILED');
		expect(code('500')).toBe(InternalError.code);
	});

	it('documents the problems of middlewares and rate limits', async () => {
		const paths = await document();
		const responses = paths['/wallets/{id}'].get.responses;

		expect(Object.keys(responses)).toEqual(['200', '401', '429', '500']);
		expect(responses['429'].content['application/json'].schema.properties.retryAfter.type).toBe(
			'integer'
		);
	});

	it('keeps a schema the route gives for a status over the problems of that status', async () => {
		const paths = await document();
		const responses = paths['/wallets/{id}'].delete.responses;

		expect(Object.keys(responses)).toEqual(['403', '409', '500']);
		expect(responses['409'].content['text/plain'].schema.type).toBe('string');
	});
});

@Http.controller('/receipts')
class ReceiptController {
	@Http.post('/', { status: 201, response: Wallet })
	public create() {
		return { id: 'r1', balance: 1, secret: 'stripped' };
	}

	@Http.del('/:id', { status: 204 })
	public remove() {
		return { ignored: true };
	}

	@Http.post('/:id/accept', { status: 201 })
	public accept(@Http.context() ctx: Context) {
		ctx.set.status = 202;
		return 'accepted';
	}

	@Http.post('/conflict', { status: 201, errors: [ConflictError] })
	public conflict() {
		return new ConflictError('Taken.');
	}
}

@Module.register({ controllers: [ReceiptController] })
class ReceiptModule extends Module {}

@Application.register({ modules: [ReceiptModule], openapi: {} })
class ReceiptApp extends Application {}

describe('route success status', () => {
	let testing: Awaited<ReturnType<typeof createTestingHttpApp>> | undefined;

	afterEach(async () => {
		await testing?.shutdown();
		testing = undefined;
	});

	it('answers with the status of the route and serializes the body', async () => {
		testing = await createTestingHttpApp({ app: ReceiptApp });
		const response = await testing.http.post('/receipts').send();

		expect(response.status).toBe(201);
		expect(await response.json()).toEqual({ id: 'r1', balance: 1 });
	});

	it('sends no body with a 204, whatever the handler returns', async () => {
		testing = await createTestingHttpApp({ app: ReceiptApp });
		const response = await testing.http.delete('/receipts/r1').send();

		expect(response.status).toBe(204);
		expect(await response.text()).toBe('');
	});

	it('keeps the status a handler sets itself', async () => {
		testing = await createTestingHttpApp({ app: ReceiptApp });
		const response = await testing.http.post('/receipts/r1/accept').send();

		expect(response.status).toBe(202);
	});

	it('answers a problem with its own status', async () => {
		testing = await createTestingHttpApp({ app: ReceiptApp });
		const response = await testing.http.post('/receipts/conflict').send();

		expect(response.status).toBe(409);
	});

	it('documents the response under the status of the route', async () => {
		testing = await createTestingHttpApp({ app: ReceiptApp });
		const paths = ((await (await testing.http.get('/openapi/json').send()).json()) as any).paths;
		const responses = (paths['/receipts'] ?? paths['/receipts/']).post.responses;

		expect(Object.keys(responses)).toContain('201');
		expect(Object.keys(responses)).not.toContain('200');
		expect(Object.keys(responses['201'].content['application/json'].schema.properties)).toEqual([
			'id',
			'balance'
		]);
	});
});
