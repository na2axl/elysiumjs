// Copyright (c) 2026-present Workbud Technologies Inc. All rights reserved.
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

import { Application, createTestingHttpApp, DomainError, Http, Module } from '@elysiumjs/core';
import { afterEach, describe, expect, it, spyOn } from 'bun:test';

import { HermesModule, JsonConsoleLogger, RequestLogInterceptor } from '../src';

const lines = (spy: { mock: { calls: unknown[][] } }) =>
	spy.mock.calls.map(([line]) => JSON.parse(String(line)) as Record<string, unknown>);

describe('JsonConsoleLogger', () => {
	it('writes JSON lines with level, time, bindings and context', () => {
		const info = spyOn(console, 'info').mockImplementation(() => {});
		try {
			new JsonConsoleLogger({ name: 'api', level: 'info' }).child({ module: 'auth' }).info('hi', {
				userId: 'u1'
			});
			const [line] = lines(info);
			expect(line).toMatchObject({
				level: 30,
				name: 'api',
				module: 'auth',
				userId: 'u1',
				msg: 'hi'
			});
			expect(typeof line!.time).toBe('number');
		} finally {
			info.mockRestore();
		}
	});

	it('drops lines under its level and serializes errors', () => {
		const debug = spyOn(console, 'debug').mockImplementation(() => {});
		const error = spyOn(console, 'error').mockImplementation(() => {});
		try {
			const logger = new JsonConsoleLogger({ level: 'info' });
			logger.debug('hidden');
			logger.error('failed', { error: new Error('boom') });
			expect(debug).not.toHaveBeenCalled();
			const [line] = lines(error);
			expect(line).toMatchObject({
				level: 50,
				msg: 'failed',
				error: { type: 'Error', message: 'boom' }
			});
		} finally {
			debug.mockRestore();
			error.mockRestore();
		}
	});

	it('is the logger of HermesModule with transport: console', async () => {
		const app = await Application.testing({
			modules: [HermesModule.with({ transport: 'console' })]
		});
		try {
			expect(await app.get('logger')).toBeInstanceOf(JsonConsoleLogger);
		} finally {
			await app.shutdown();
		}
	});
});

@Http.controller({ path: '/logs' })
class LogController {
	@Http.get({ path: '/ok/:id' })
	public ok() {
		return { ok: true };
	}

	@Http.get({ path: '/missing' })
	public missing() {
		throw DomainError.notFound('nope');
	}

	@Http.get({ path: '/boom' })
	public boom() {
		throw new Error('boom');
	}
}

@Module.register({ controllers: [LogController] })
class LogModule extends Module {}

@Application.register({
	modules: [HermesModule.with({ transport: 'console', level: 'info' }), LogModule],
	interceptors: [RequestLogInterceptor],
	openapi: false
})
class LogApp extends Application {}

describe('RequestLogInterceptor', () => {
	let testing: TestingHttpApp | undefined;

	afterEach(async () => {
		await testing?.shutdown();
		testing = undefined;
	});

	it('logs one line per request, at a level that follows the status', async () => {
		const info = spyOn(console, 'info').mockImplementation(() => {});
		const warn = spyOn(console, 'warn').mockImplementation(() => {});
		const error = spyOn(console, 'error').mockImplementation(() => {});
		try {
			testing = await Application.testing({ app: LogApp });
			await testing.http.get('/logs/ok/1').header('x-request-id', 'req-1');
			await testing.http.get('/logs/missing');
			await testing.http.get('/logs/boom');

			const ok = lines(info).find((line) => line.path === '/logs/ok/1');
			expect(ok).toMatchObject({
				method: 'GET',
				status: 200,
				requestId: 'req-1',
				msg: 'GET /logs/ok/1 200'
			});
			expect(typeof ok!.durationMs).toBe('number');
			expect(lines(warn).find((line) => line.path === '/logs/missing')).toMatchObject({
				status: 404
			});
			expect(lines(error).find((line) => line.path === '/logs/boom')).toMatchObject({
				status: 500,
				error: { message: 'boom' }
			});
		} finally {
			info.mockRestore();
			warn.mockRestore();
			error.mockRestore();
		}
	});
});
