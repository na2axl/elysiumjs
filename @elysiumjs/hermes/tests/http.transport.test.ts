// Copyright (c) 2026-present Axel Nana <ax.lnana@outlook.com>. All rights reserved.
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

import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';

import { HttpTransport } from '../src/transports/http.transport';

describe('HttpTransport', () => {
	let fetchSpy: ReturnType<typeof spyOn>;

	beforeEach(() => {
		fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'));
	});

	afterEach(() => {
		fetchSpy.mockRestore();
	});

	describe('constructor', () => {
		it('should create with default options', async () => {
			const transport = new HttpTransport({ url: 'http://localhost:3000/logs' });
			expect(transport).toBeDefined();
			await transport.close();
		});
	});

	describe('write()', () => {
		it('should buffer messages', async () => {
			const transport = new HttpTransport({
				url: 'http://localhost:3000/logs',
				batchSize: 10,
				flushInterval: 60000
			});

			transport.write('log entry 1');
			transport.write('log entry 2');

			// Not yet flushed since batchSize is 10
			expect(fetchSpy).not.toHaveBeenCalled();

			await transport.close();
		});

		it('should auto-flush when batchSize is reached', async () => {
			const transport = new HttpTransport({
				url: 'http://localhost:3000/logs',
				batchSize: 2,
				flushInterval: 60000
			});

			transport.write('log 1');
			transport.write('log 2');

			// Yield to let the async flush() complete
			await Promise.resolve();

			// Should have flushed
			expect(fetchSpy).toHaveBeenCalled();

			await transport.close();
		});

		it('should drop oldest messages when maxBufferSize is reached', async () => {
			const transport = new HttpTransport({
				url: 'http://localhost:3000/logs',
				batchSize: 100,
				flushInterval: 60000,
				maxBufferSize: 2
			});

			transport.write('log 1');
			transport.write('log 2');
			transport.write('log 3');

			await transport.flush();

			const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string);
			expect(body.logs).toHaveLength(2);
			expect(body.logs[0]).toBe('log 2');
			expect(body.logs[1]).toBe('log 3');

			await transport.close();
		});
	});

	describe('flush()', () => {
		it('should send buffered logs via POST', async () => {
			const transport = new HttpTransport({
				url: 'http://localhost:3000/logs',
				batchSize: 100,
				flushInterval: 60000
			});

			transport.write('entry 1');
			transport.write('entry 2');

			await transport.flush();

			expect(fetchSpy).toHaveBeenCalledTimes(1);
			const [url, options] = fetchSpy.mock.calls[0];
			expect(url).toBe('http://localhost:3000/logs');
			expect(options!.method).toBe('POST');
			expect(options!.headers).toEqual(
				expect.objectContaining({ 'Content-Type': 'application/json' })
			);

			const body = JSON.parse(options!.body as string);
			expect(body.logs).toEqual(['entry 1', 'entry 2']);

			await transport.close();
		});

		it('should include custom headers', async () => {
			const transport = new HttpTransport({
				url: 'http://localhost:3000/logs',
				headers: { Authorization: 'Bearer token123' },
				batchSize: 100,
				flushInterval: 60000
			});

			transport.write('entry');
			await transport.flush();

			const [, options] = fetchSpy.mock.calls[0];
			expect(options!.headers).toEqual(
				expect.objectContaining({
					'Content-Type': 'application/json',
					Authorization: 'Bearer token123'
				})
			);

			await transport.close();
		});

		it('should not send if buffer is empty', async () => {
			const transport = new HttpTransport({
				url: 'http://localhost:3000/logs',
				batchSize: 100,
				flushInterval: 60000
			});

			await transport.flush();
			expect(fetchSpy).not.toHaveBeenCalled();

			await transport.close();
		});

		it('should re-buffer logs on fetch failure', async () => {
			fetchSpy.mockRejectedValueOnce(new Error('Network error'));

			const transport = new HttpTransport({
				url: 'http://localhost:3000/logs',
				batchSize: 100,
				flushInterval: 60000
			});

			transport.write('entry 1');
			transport.write('entry 2');

			await transport.flush();

			// The failed batch should be re-buffered, flush again
			await transport.flush();

			expect(fetchSpy).toHaveBeenCalledTimes(2);
			const body = JSON.parse(fetchSpy.mock.calls[1][1]!.body as string);
			expect(body.logs).toEqual(['entry 1', 'entry 2']);

			await transport.close();
		});
	});

	describe('close()', () => {
		it('should flush remaining logs and clear timer', async () => {
			const transport = new HttpTransport({
				url: 'http://localhost:3000/logs',
				batchSize: 100,
				flushInterval: 60000
			});

			transport.write('final entry');
			await transport.close();

			expect(fetchSpy).toHaveBeenCalledTimes(1);
			const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string);
			expect(body.logs).toEqual(['final entry']);
		});
	});
});
