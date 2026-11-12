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

import { SpanStatusCode, trace } from '@opentelemetry/api';
import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';

import { Traced } from '../src/decorators/traced';

describe('@Traced decorator', () => {
	let mockSpan: any;
	let mockTracer: any;
	let getTracerSpy: ReturnType<typeof spyOn>;

	beforeEach(() => {
		mockSpan = {
			setStatus: mock(() => {}),
			recordException: mock(() => {}),
			end: mock(() => {})
		};

		mockTracer = {
			startActiveSpan: mock(async (_name: string, _options: any, fn: any) => {
				return fn(mockSpan);
			})
		};

		getTracerSpy = spyOn(trace, 'getTracer').mockReturnValue(mockTracer);
	});

	afterEach(() => {
		getTracerSpy.mockRestore();
	});

	it('should call the original method and return its result', async () => {
		class MyService {
			@Traced()
			async greet(name: string): Promise<string> {
				return `Hello, ${name}`;
			}
		}

		const service = new MyService();
		const result = await service.greet('World');
		expect(result).toBe('Hello, World');
	});

	it('should create a span with default name', async () => {
		class MyService {
			@Traced()
			async doWork(): Promise<void> {}
		}

		const service = new MyService();
		await service.doWork();

		expect(mockTracer.startActiveSpan).toHaveBeenCalled();
		const [spanName] = mockTracer.startActiveSpan.mock.calls[0];
		expect(spanName).toBe('MyService.doWork');
	});

	it('should create a span with custom name', async () => {
		class MyService {
			@Traced('custom.span.name')
			async doWork(): Promise<void> {}
		}

		const service = new MyService();
		await service.doWork();

		const [spanName] = mockTracer.startActiveSpan.mock.calls[0];
		expect(spanName).toBe('custom.span.name');
	});

	it('should set OK status on success', async () => {
		class MyService {
			@Traced()
			async success(): Promise<string> {
				return 'ok';
			}
		}

		const service = new MyService();
		await service.success();

		expect(mockSpan.setStatus).toHaveBeenCalledWith({
			code: SpanStatusCode.OK
		});
		expect(mockSpan.end).toHaveBeenCalled();
	});

	it('should set ERROR status and record exception on failure', async () => {
		const error = new Error('test failure');

		class MyService {
			@Traced()
			async failing(): Promise<void> {
				throw error;
			}
		}

		const service = new MyService();
		await expect(service.failing()).rejects.toThrow('test failure');

		expect(mockSpan.setStatus).toHaveBeenCalledWith({
			code: SpanStatusCode.ERROR,
			message: 'test failure'
		});
		expect(mockSpan.recordException).toHaveBeenCalledWith(error);
		expect(mockSpan.end).toHaveBeenCalled();
	});

	it('should handle non-Error throws', async () => {
		class MyService {
			@Traced()
			async throwString(): Promise<void> {
				throw 'string error';
			}
		}

		const service = new MyService();
		try {
			await service.throwString();
		} catch {
			// expected
		}

		expect(mockSpan.setStatus).toHaveBeenCalledWith({
			code: SpanStatusCode.ERROR,
			message: 'Unknown error'
		});
	});

	it('should always end the span', async () => {
		class MyService {
			@Traced()
			async mayFail(): Promise<void> {
				throw new Error('fail');
			}
		}

		const service = new MyService();
		try {
			await service.mayFail();
		} catch {
			// expected
		}

		expect(mockSpan.end).toHaveBeenCalledTimes(1);
	});

	it('should use the @elysiumjs/argus tracer', async () => {
		class MyService {
			@Traced()
			async work(): Promise<void> {}
		}

		const service = new MyService();
		await service.work();

		expect(getTracerSpy).toHaveBeenCalledWith('@elysiumjs/argus');
	});
});
