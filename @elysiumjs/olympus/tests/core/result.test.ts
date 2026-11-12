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
import { t } from 'elysia';

import { Application } from '../../src/app';
import { Http } from '../../src/http';
import { Module } from '../../src/module';
import { ConflictError, ForbiddenError } from '../../src/problem';
import { AsyncResult, Failed, Passed, Result } from '../../src/result';
import { createTestingHttpApp } from '../../src/testing';

const mayBuy = (adult: boolean): Result<{ id: string }, ForbiddenError> =>
	adult ? Result.pass({ id: 'a1' }) : Result.fail(new ForbiddenError('Adults only.'));

describe('Result', () => {
	it('narrows to the passed side with check()', () => {
		const buyer = mayBuy(true);
		expect(buyer.check()).toBe(true);
		if (!buyer.check()) throw new Error('unreachable');
		expect(buyer.result.id).toBe('a1');
		expect(buyer.error).toBeUndefined();
	});

	it('narrows to the failed side on the other branch', () => {
		const buyer = mayBuy(false);
		if (buyer.check()) throw new Error('unreachable');
		const error: ForbiddenError = buyer.error;
		expect(error).toBeInstanceOf(ForbiddenError);
		expect(buyer.result).toBeUndefined();
	});

	it('gives the value or throws the error with orThrow()', () => {
		expect(mayBuy(true).orThrow()).toEqual({ id: 'a1' });
		expect(() => mayBuy(false).orThrow()).toThrow(ForbiddenError);
	});

	it('gives the value or the error with orError()', () => {
		expect(mayBuy(true).orError()).toEqual({ id: 'a1' });
		expect(mayBuy(false).orError()).toBeInstanceOf(ForbiddenError);
	});

	it('gives the error or the transformed value with errorOr()', () => {
		expect(mayBuy(true).errorOr((buyer) => buyer.id)).toBe('a1');
		let called = false;
		const answer = mayBuy(false).errorOr(() => (called = true));
		expect(answer).toBeInstanceOf(ForbiddenError);
		expect(called).toBe(false);
	});

	it('transforms the value with map() and keeps a failure', () => {
		expect(
			mayBuy(true)
				.map((buyer) => buyer.id)
				.orThrow()
		).toBe('a1');
		const failed = mayBuy(false);
		expect(failed.map((buyer) => buyer.id)).toBe(failed as Failed<ForbiddenError>);
	});

	it('chains the next step with andThen() and skips it on failure', () => {
		const pay = (id: string): Result<number, ConflictError> =>
			id === 'a1' ? Result.pass(10) : Result.fail(new ConflictError('Taken.'));

		expect(
			mayBuy(true)
				.andThen((buyer) => pay(buyer.id))
				.orThrow()
		).toBe(10);
		let called = false;
		const skipped = mayBuy(false).andThen((buyer) => {
			called = true;
			return pay(buyer.id);
		});
		expect(skipped.check()).toBe(false);
		expect(called).toBe(false);
	});

	it('tells results from other values with is()', () => {
		expect(Result.is(Result.pass(1))).toBe(true);
		expect(Result.is(Result.fail(new ConflictError()))).toBe(true);
		expect(Result.is({ result: 1, error: undefined })).toBe(false);
		expect(Result.is(undefined)).toBe(false);
	});

	it('makes a result of a value or a DomainError with of()', () => {
		const value: { id: string } | ConflictError = { id: 'a1' };
		const passed = Result.of(value as { id: string } | ConflictError);
		expect(passed).toBeInstanceOf(Passed);
		expect(passed.orThrow()).toEqual({ id: 'a1' });

		const failed = Result.of(new ConflictError('Taken.') as { id: string } | ConflictError);
		expect(failed).toBeInstanceOf(Failed);
		expect(failed.error).toBeInstanceOf(ConflictError);

		const result = Result.pass(1);
		expect(Result.of(result)).toBe(result);
	});

	it('is not a thenable, so awaiting it gives the result itself', async () => {
		const result = Result.pass(1);
		expect(await result).toBe(result);
	});
});

describe('AsyncResult', () => {
	const open = async (ok: boolean) => (ok ? { id: 'w1' } : new ConflictError('Closed.'));

	it('awaits to the result of a promise of a value or a DomainError', async () => {
		const passed = await AsyncResult.from(open(true));
		expect(passed.check() && passed.result.id).toBe('w1');

		const failed = await AsyncResult.from(open(false));
		expect(failed.error).toBeInstanceOf(ConflictError);
	});

	it('keeps a result the promise resolves to', async () => {
		const result = Result.pass(1);
		expect(await AsyncResult.from(Promise.resolve(result))).toBe(result);
	});

	it('resolves to the value or rejects with the error with orThrow()', async () => {
		expect(await AsyncResult.from(open(true)).orThrow()).toEqual({ id: 'w1' });
		await expect(AsyncResult.from(open(false)).orThrow()).rejects.toBeInstanceOf(ConflictError);
	});

	it('resolves to the value or the error with orError()', async () => {
		expect(await AsyncResult.from(open(true)).orError()).toEqual({ id: 'w1' });
		expect(await AsyncResult.from(open(false)).orError()).toBeInstanceOf(ConflictError);
	});

	it('resolves to the error or the transformed value with errorOr()', async () => {
		expect(await AsyncResult.from(open(true)).errorOr(async (w) => w.id)).toBe('w1');
		expect(await AsyncResult.from(open(false)).errorOr((w) => w.id)).toBeInstanceOf(ConflictError);
	});

	it('chains map() and andThen() without awaiting first', async () => {
		const balance = (id: string) =>
			AsyncResult.from(Promise.resolve(id === 'w1' ? 7 : new ForbiddenError()));

		const passed = AsyncResult.from(open(true))
			.map((w) => w.id)
			.andThen(balance)
			.map((n) => n * 2);
		expect(await passed.orThrow()).toBe(14);

		let called = false;
		const failed = AsyncResult.from(open(false)).andThen((w) => {
			called = true;
			return Result.pass(w.id);
		});
		expect((await failed).error).toBeInstanceOf(ConflictError);
		expect(called).toBe(false);
	});

	it('rejects when the promise rejects', async () => {
		const boom = AsyncResult.from(Promise.reject<string>(new Error('boom')));
		await expect(boom.orError()).rejects.toThrow('boom');
	});
});

const Wallet = t.Object({ id: t.String(), balance: t.Integer() });

@Http.controller('/results')
class ResultController {
	@Http.get('/:id', { response: Wallet, errors: [ConflictError] })
	public show(@Http.param('id') id: string) {
		return id === 'closed'
			? Result.fail(new ConflictError('Closed.'))
			: Result.pass({ id, balance: 3, secret: 'stripped' });
	}

	@Http.get('/:id/later', { response: Wallet, errors: [ConflictError] })
	public later(@Http.param('id') id: string) {
		return AsyncResult.from(
			Promise.resolve(id === 'closed' ? new ConflictError('Closed.') : { id, balance: 4 })
		);
	}
}

@Module.register({ controllers: [ResultController] })
class ResultModule extends Module {}

@Application.register({ modules: [ResultModule] })
class ResultApp extends Application {}

describe('a handler returning a Result', () => {
	let testing: Awaited<ReturnType<typeof createTestingHttpApp>> | undefined;

	afterEach(async () => {
		await testing?.shutdown();
		testing = undefined;
	});

	it('answers the value of a passed result', async () => {
		testing = await createTestingHttpApp({ app: ResultApp });
		const response = await testing.http.get('/results/w1').send();

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ id: 'w1', balance: 3 });
	});

	it('answers the problem of a failed result', async () => {
		testing = await createTestingHttpApp({ app: ResultApp });
		const response = await testing.http.get('/results/closed').send();

		expect(response.status).toBe(409);
		expect(await response.json()).toMatchObject({ code: 'CONFLICT' });
	});

	it('answers an AsyncResult once it settles', async () => {
		testing = await createTestingHttpApp({ app: ResultApp });
		const passed = await testing.http.get('/results/w1/later').send();
		expect(passed.status).toBe(200);
		expect(await passed.json()).toEqual({ id: 'w1', balance: 4 });

		const failed = await testing.http.get('/results/closed/later').send();
		expect(failed.status).toBe(409);
	});
});
