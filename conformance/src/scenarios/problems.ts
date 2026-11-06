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

import { Application, DomainError, Http, Module, NotFoundError } from '@elysiumjs/core';
import { t } from 'elysia';

class InsufficientFunds extends DomainError.for('INSUFFICIENT_FUNDS', 409) {
	constructor(missing: number) {
		super(`${missing} more are needed.`, { extensions: { missing } });
	}
}

const make = async (): Promise<Application> => {
	@Http.controller('/p')
	class ProblemController {
		@Http.get('/missing')
		public missing() {
			throw new NotFoundError('No such post.', { extensions: { postId: 7 } });
		}

		@Http.post('/pay')
		public pay(): { paid: true } | InsufficientFunds {
			return new InsufficientFunds(3);
		}

		@Http.get('/status')
		public status(@Http.context() c: any) {
			throw c.status(403, 'no');
		}

		@Http.get('/boom')
		public boom() {
			throw new Error('boom');
		}

		@Http.post('/signup')
		public signup(@Http.body(t.Object({ email: t.String(), age: t.Number() })) body: unknown) {
			return body;
		}
	}

	@Module.register({ controllers: [ProblemController] })
	class ProblemModule extends Module {}

	@Application.register({
		modules: [ProblemModule],
		openapi: false,
		problems: { typeBase: 'https://api.example.com/problems/' }
	})
	class ProblemApp extends Application {}

	return new ProblemApp();
};

const problemJson = { 'content-type': 'application/problem+json' };

/**
 * Errors are rendered as RFC 9457 problem details with a `code` and the request id: domain errors
 * thrown or returned with their status, validation errors with JSON pointers, unexpected errors
 * as 500. A thrown status is sent as is.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export const problems: Scenario = {
	name: 'problems: errors render as problem details',
	app: make,
	requests: [
		{
			request: () =>
				new Request('http://localhost/p/missing', { headers: { 'x-request-id': 'req-1' } }),
			expect: {
				status: 404,
				headers: problemJson,
				json: {
					type: 'https://api.example.com/problems/not-found',
					title: 'Not Found',
					status: 404,
					code: 'NOT_FOUND',
					detail: 'No such post.',
					postId: 7,
					requestId: 'req-1',
					instance: '/p/missing'
				}
			}
		},
		{
			request: () => new Request('http://localhost/p/pay', { method: 'POST' }),
			expect: {
				status: 409,
				headers: problemJson,
				includes: {
					type: 'https://api.example.com/problems/insufficient-funds',
					code: 'INSUFFICIENT_FUNDS',
					detail: '3 more are needed.',
					missing: 3
				}
			}
		},
		{
			request: () =>
				new Request('http://localhost/p/signup', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ email: 'a@b.co' })
				}),
			expect: {
				status: 422,
				headers: problemJson,
				includes: {
					type: 'https://api.example.com/problems/validation-failed',
					title: 'Unprocessable Entity',
					status: 422,
					code: 'VALIDATION_FAILED',
					detail: 'The request body is invalid.',
					instance: '/p/signup',
					errors: [{ pointer: '/body/age', message: 'is required', code: 'requiredProperties' }]
				}
			}
		},
		{
			request: () => new Request('http://localhost/p/status'),
			expect: { status: 403, text: 'no' }
		},
		{
			request: () => new Request('http://localhost/p/boom'),
			expect: { status: 500, headers: problemJson, includes: { code: 'INTERNAL_ERROR' } }
		},
		{
			request: () => new Request('http://localhost/nowhere'),
			expect: { status: 404, headers: problemJson, includes: { code: 'NOT_FOUND' } }
		}
	]
};
