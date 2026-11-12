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

import type { ExceptionFilter } from '@elysiumjs/olympus';
import type { Scenario } from './types';

import { Application, Catch, Http, Module, Service } from '@elysiumjs/olympus';

class DeclinedError extends Error {}

const make = async (): Promise<Application> => {
	class Reasons {
		public reason() {
			return 'card declined';
		}
	}

	@Catch(DeclinedError)
	class DeclinedFilter implements ExceptionFilter<DeclinedError> {
		constructor(@Service.inject(Reasons) private reasons: Reasons) {}

		public catch() {
			return {
				type: 'about:blank',
				title: 'Payment Required',
				status: 402,
				reason: this.reasons.reason()
			};
		}
	}

	@Catch()
	class AppFilter implements ExceptionFilter {
		public catch(_error: unknown, ctx: { path: string }) {
			return ctx.path === '/missing' ? new Response('nothing here', { status: 404 }) : undefined;
		}
	}

	@Http.controller('/pay')
	class PayController {
		@Http.post()
		public pay() {
			throw new DeclinedError();
		}
	}

	@Module.register({ services: [Reasons], controllers: [PayController], filters: [DeclinedFilter] })
	class PayModule extends Module {}

	@Application.register({ modules: [PayModule], openapi: false, filters: [AppFilter] })
	class PayApp extends Application {}

	return new PayApp();
};

/**
 * Exception filters turn errors into responses: a module filter with an injected service, and an
 * app filter for errors raised before routing.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export const filters: Scenario = {
	name: 'filters: module and app exception filters',
	app: make,
	requests: [
		{
			request: () => new Request('http://localhost/pay', { method: 'POST' }),
			expect: {
				status: 402,
				headers: { 'content-type': 'application/problem+json' },
				json: {
					type: 'about:blank',
					title: 'Payment Required',
					status: 402,
					reason: 'card declined'
				}
			}
		},
		{
			request: () => new Request('http://localhost/missing'),
			expect: { status: 404, text: 'nothing here' }
		}
	]
};
