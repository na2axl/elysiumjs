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

import type { ExceptionFilter, FilterContext } from '../src/filter';

import { afterEach, describe, expect, it } from 'bun:test';

import { Application } from '../src/app';
import { Catch } from '../src/filter';
import { Http } from '../src/http';
import { Module } from '../src/module';
import { ConflictError, DomainError } from '../src/problem';
import { Service } from '../src/service';
import { createTestingHttpApp } from '../src/testing';

class PaymentError extends Error {
	constructor(public readonly reason: string) {
		super(`Payment failed: ${reason}`);
	}
}

class OtherError extends Error {}

const log: string[] = [];

@Catch(PaymentError)
class RouteFilter implements ExceptionFilter<PaymentError> {
	public catch(error: PaymentError) {
		log.push('route');
		if (error.reason === 'pass') return undefined;
		return { level: 'route', reason: error.reason };
	}
}

@Catch(PaymentError)
class ControllerFilter implements ExceptionFilter<PaymentError> {
	public catch(error: PaymentError, ctx: FilterContext) {
		log.push('controller');
		ctx.set.status = 402;
		return { level: 'controller', reason: error.reason };
	}
}

@Catch(OtherError)
class SkippedFilter implements ExceptionFilter {
	public catch() {
		log.push('skipped');
		return 'never';
	}
}

@Catch(PaymentError)
class ThrowingFilter implements ExceptionFilter {
	public catch(): never {
		log.push('throwing');
		throw new Error('filter bug');
	}
}

class Labels {
	public label() {
		return 'from a service';
	}
}

@Catch()
class ModuleFilter implements ExceptionFilter {
	constructor(@Service.inject(Labels) private labels: Labels) {}

	public catch(error: unknown) {
		log.push('module');
		if (error instanceof DomainError) return undefined;
		return { type: 'about:blank', title: 'Handled', status: 418, label: this.labels.label() };
	}
}

@Catch()
class AppFilter implements ExceptionFilter {
	public catch(_error: unknown, ctx: FilterContext) {
		log.push('app');
		if (ctx.path === '/nowhere') return new Response('custom 404', { status: 404 });
		return undefined;
	}
}

@Http.controller('/f', { filters: [SkippedFilter, ControllerFilter] })
class FilteredController {
	@Http.get('/route', { filters: [RouteFilter] })
	public route(@Http.query() query: { reason: string }) {
		throw new PaymentError(query.reason);
	}

	@Http.get('/throwing', { filters: [ThrowingFilter] })
	public throwing() {
		throw new PaymentError('declined');
	}

	@Http.get('/generic')
	public generic() {
		throw new Error('generic');
	}

	@Http.get('/domain')
	public domain() {
		throw new ConflictError('taken');
	}
}

@Module.register({
	services: [Labels],
	controllers: [FilteredController],
	filters: [ModuleFilter]
})
class FilteredModule extends Module {}

@Application.register({ modules: [FilteredModule], openapi: false, filters: [AppFilter] })
class FilteredApp extends Application {}

describe('exception filters', () => {
	let testing: Awaited<ReturnType<typeof createTestingHttpApp>> | undefined;

	afterEach(async () => {
		await testing?.shutdown();
		testing = undefined;
		log.length = 0;
	});

	const start = async () => {
		testing = await createTestingHttpApp({ app: FilteredApp });
		return testing.http;
	};

	it('runs the route filter first', async () => {
		const http = await start();
		const response = await http.get('/f/route').query({ reason: 'declined' });

		expect(await response.json()).toEqual({ level: 'route', reason: 'declined' });
		expect(log).toEqual(['route']);
	});

	it('falls through to the controller when a filter returns undefined, skipping unmatched ones', async () => {
		const http = await start();
		const response = await http.get('/f/route').query({ reason: 'pass' });

		expect(response.status).toBe(402);
		expect(await response.json()).toEqual({ level: 'controller', reason: 'pass' });
		expect(log).toEqual(['route', 'controller']);
	});

	it('hands the original error to the next filter when a filter throws', async () => {
		const http = await start();
		const response = await http.get('/f/throwing');

		expect(response.status).toBe(402);
		expect(await response.json()).toEqual({ level: 'controller', reason: 'declined' });
		expect(log).toEqual(['throwing', 'controller']);
	});

	it('runs module filters in their module, with injection, and sends problem details', async () => {
		const http = await start();
		const response = await http.get('/f/generic');

		expect(response.status).toBe(418);
		expect(response.headers.get('content-type')).toBe('application/problem+json');
		expect(await response.json()).toEqual({
			type: 'about:blank',
			title: 'Handled',
			status: 418,
			label: 'from a service'
		});
		expect(log).toEqual(['module']);
	});

	it('ends with the default problem details when no filter handles the error', async () => {
		const http = await start();
		const response = await http.get('/f/domain');

		expect(response.status).toBe(409);
		expect((await response.json()).detail).toBe('taken');
		expect(log).toEqual(['module', 'app']);
	});

	it('only runs app filters for errors raised before routing', async () => {
		const http = await start();
		const response = await http.get('/nowhere');

		expect(response.status).toBe(404);
		expect(await response.text()).toBe('custom 404');
		expect(log).toEqual(['app']);
	});
});
