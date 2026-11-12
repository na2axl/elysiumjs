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

import type { Scenario } from './types';

import { Application, Http, MemoryRateLimitStore, Module, RateLimit } from '@elysiumjs/core';

const make = async (): Promise<Application> => {
	@Http.controller('/limited')
	class LimitedController {
		@Http.get('/')
		@RateLimit({ window: 60_000, max: 2, key: () => 'client' })
		public index() {
			return 'ok';
		}

		@Http.get('/free')
		@RateLimit(false)
		public free() {
			return 'free';
		}
	}

	@Module.register({ controllers: [LimitedController] })
	class LimitedModule extends Module {}

	@Application.register({
		modules: [LimitedModule],
		openapi: false,
		rateLimit: { store: new MemoryRateLimitStore() }
	})
	class LimitedApp extends Application {}

	return new LimitedApp();
};

const limited = () => new Request('http://localhost/limited');

/**
 * A rate limited route sends the `RateLimit-*` headers, and answers 429 problem details with
 * `Retry-After` once a client goes over the limit.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export const rateLimits: Scenario = {
	name: 'rate limits: RateLimit headers and 429',
	app: make,
	requests: [
		{
			request: limited,
			expect: {
				status: 200,
				text: 'ok',
				headers: {
					'ratelimit-limit': '2',
					'ratelimit-remaining': '1',
					'ratelimit-policy': '2;w=60'
				}
			}
		},
		{
			request: limited,
			expect: { status: 200, headers: { 'ratelimit-remaining': '0' } }
		},
		{
			request: limited,
			expect: {
				status: 429,
				headers: {
					'content-type': 'application/problem+json',
					'ratelimit-remaining': '0'
				}
			}
		},
		{
			request: () => new Request('http://localhost/limited/free'),
			expect: { status: 200, text: 'free' }
		}
	]
};
