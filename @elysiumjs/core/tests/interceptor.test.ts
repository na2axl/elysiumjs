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

import type { ExceptionFilter } from '../src/filter';
import type { Interceptor, InterceptorContext } from '../src/interceptor';

import { afterEach, describe, expect, it } from 'bun:test';

import { Application } from '../src/app';
import { Catch } from '../src/filter';
import { Http } from '../src/http';
import { TimingInterceptor, TransformInterceptor } from '../src/interceptor';
import { Module } from '../src/module';
import { Service, ServiceScope } from '../src/service';
import { createTestingHttpApp } from '../src/testing';

const log: string[] = [];

const named = (name: string) =>
	class implements Interceptor {
		public async intercept(_ctx: InterceptorContext, next: () => Promise<unknown>) {
			log.push(`${name}:before`);
			const result = await next();
			log.push(`${name}:after`);
			return result;
		}
	};

const AppLevel = named('app');
const ModuleLevel = named('module');
const ControllerLevel = named('controller');
const RouteLevel = named('route');

class ShortCircuit implements Interceptor {
	public async intercept() {
		return { cached: true };
	}
}

class Twice implements Interceptor {
	public async intercept(_ctx: InterceptorContext, next: () => Promise<unknown>) {
		await next();
		return next();
	}
}

let counter = 0;

@Service.register({ scope: ServiceScope.REQUEST })
class RequestId {
	public readonly id = ++counter;
}

@Service.register({ scope: ServiceScope.REQUEST })
class StampInterceptor implements Interceptor {
	constructor(@Service.inject(RequestId) private requestId: RequestId) {}

	public async intercept(_ctx: InterceptorContext, next: () => Promise<unknown>) {
		const result = (await next()) as Record<string, unknown>;
		return { ...result, stamped: this.requestId.id };
	}
}

class Caught extends Error {}

@Catch(Caught)
class CaughtFilter implements ExceptionFilter {
	public catch() {
		log.push('filter');
		return { filtered: true };
	}
}

@Http.controller('/i', { interceptors: [ControllerLevel] })
class InterceptedController {
	@Http.get('/order', { interceptors: [RouteLevel] })
	public order() {
		log.push('handler');
		return { ok: true };
	}

	@Http.get('/short', { interceptors: [ShortCircuit] })
	public short() {
		log.push('handler');
		return { cached: false };
	}

	@Http.get('/twice', { interceptors: [Twice] })
	public twice() {
		log.push('handler');
		return 'once';
	}

	@Http.get('/stamp', { interceptors: [StampInterceptor] })
	public stamp(@Service.inject(RequestId) requestId: RequestId) {
		return { id: requestId.id };
	}

	@Http.get('/throws', { filters: [CaughtFilter] })
	public throws() {
		log.push('handler');
		throw new Caught();
	}

	@Http.get('/transform', {
		interceptors: [
			TimingInterceptor,
			TransformInterceptor.with<number[], { data: number[] }>((data) => ({ data }))
		]
	})
	public transform() {
		return [1, 2];
	}
}

@Module.register({
	services: [RequestId],
	controllers: [InterceptedController],
	interceptors: [ModuleLevel]
})
class InterceptedModule extends Module {}

@Application.register({ modules: [InterceptedModule], openapi: false, interceptors: [AppLevel] })
class InterceptedApp extends Application {}

describe('interceptors', () => {
	let testing: Awaited<ReturnType<typeof createTestingHttpApp>> | undefined;

	afterEach(async () => {
		await testing?.shutdown();
		testing = undefined;
		log.length = 0;
	});

	const start = async () => {
		testing = await createTestingHttpApp({ app: InterceptedApp });
		return testing.http;
	};

	const outer = ['app', 'module', 'controller'];
	const before = outer.map((n) => `${n}:before`);
	const after = [...outer].reverse().map((n) => `${n}:after`);

	it('wraps the handler from the app inwards to the route', async () => {
		const http = await start();
		const response = await http.get('/i/order');

		expect(await response.json()).toEqual({ ok: true });
		expect(log).toEqual([...before, 'route:before', 'handler', 'route:after', ...after]);
	});

	it('skips the handler when an interceptor does not call next()', async () => {
		const http = await start();
		const response = await http.get('/i/short');

		expect(await response.json()).toEqual({ cached: true });
		expect(log).toEqual([...before, ...after]);
	});

	it('rejects a second call of next()', async () => {
		const http = await start();
		const response = await http.get('/i/twice');

		expect(response.status).toBe(500);
		expect(log.filter((entry) => entry === 'handler')).toHaveLength(1);
	});

	it('builds request-scoped interceptors per request, with the request services', async () => {
		const http = await start();
		const first = await (await http.get('/i/stamp')).json();
		const second = await (await http.get('/i/stamp')).json();

		expect(first.stamped).toBe(first.id);
		expect(second.stamped).toBe(second.id);
		expect(second.id).not.toBe(first.id);
	});

	it('lets handler errors through to the filters', async () => {
		const http = await start();
		const response = await http.get('/i/throws');

		expect(await response.json()).toEqual({ filtered: true });
		expect(log).toEqual([...before, 'handler', 'filter']);
	});

	it('types the result it receives and the one it returns', () => {
		TransformInterceptor.with<number[], number>((data) => data.length);
		// @ts-expect-error The transform must return TOut.
		TransformInterceptor.with<number[], number>((data) => data.join(','));
	});

	it('times the handler and transforms its result', async () => {
		const http = await start();
		const response = await http.get('/i/transform');

		expect(await response.json()).toEqual({ data: [1, 2] });
		expect(response.headers.get('server-timing')).toMatch(/^handler;dur=\d+\.\d$/);
	});
});
