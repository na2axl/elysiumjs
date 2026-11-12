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

import { trace } from '@opentelemetry/api';
import { afterEach, describe, expect, it, spyOn } from 'bun:test';

import { withTraceContext } from '../src/correlation';

describe('withTraceContext', () => {
	let getActiveSpanSpy: ReturnType<typeof spyOn>;

	afterEach(() => {
		getActiveSpanSpy?.mockRestore();
	});

	it('should return context unchanged when no active span', () => {
		getActiveSpanSpy = spyOn(trace, 'getActiveSpan').mockReturnValue(undefined as any);

		const ctx = { userId: '123' };
		const result = withTraceContext(ctx);

		expect(result).toEqual({ userId: '123' });
		expect(result).toBe(ctx); // Same reference
	});

	it('should enrich context with traceId and spanId', () => {
		const mockSpan = {
			spanContext: () => ({
				traceId: 'abc123',
				spanId: 'def456',
				traceFlags: 1
			})
		};
		getActiveSpanSpy = spyOn(trace, 'getActiveSpan').mockReturnValue(mockSpan as any);

		const result = withTraceContext({ userId: '123' });

		expect(result.userId).toBe('123');
		expect(result.traceId).toBe('abc123');
		expect(result.spanId).toBe('def456');
	});

	it('should work with empty context', () => {
		const mockSpan = {
			spanContext: () => ({
				traceId: 'trace-1',
				spanId: 'span-1',
				traceFlags: 1
			})
		};
		getActiveSpanSpy = spyOn(trace, 'getActiveSpan').mockReturnValue(mockSpan as any);

		const result = withTraceContext();

		expect(result.traceId).toBe('trace-1');
		expect(result.spanId).toBe('span-1');
	});

	it('should not mutate the original context', () => {
		const mockSpan = {
			spanContext: () => ({
				traceId: 'trace-1',
				spanId: 'span-1',
				traceFlags: 1
			})
		};
		getActiveSpanSpy = spyOn(trace, 'getActiveSpan').mockReturnValue(mockSpan as any);

		const original = { key: 'value' };
		const result = withTraceContext(original);

		expect(original).toEqual({ key: 'value' }); // Not mutated
		expect(result).not.toBe(original); // New object
	});
});
