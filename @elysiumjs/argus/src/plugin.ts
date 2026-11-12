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

import type { Span } from '@opentelemetry/api';

import { SpanStatusCode, trace } from '@opentelemetry/api';
import { Elysia } from 'elysia';

/**
 * Elysia plugin that creates OpenTelemetry request spans.
 *
 * Each HTTP request gets a span with method, path, and status information.
 * Errors (5xx) are recorded as error spans.
 *
 * @author Axel Nana <ax.lnana@outlook.com>
 * @returns An Elysia plugin instance.
 */
export const argusPlugin = () => {
	const tracer = trace.getTracer('@elysiumjs/argus');
	const failed = new WeakSet<Span>();

	return (
		new Elysia({ name: '@elysiumjs/argus' })
			.derive('global', ({ request }) => {
				const url = new URL(request.url);
				const span = tracer.startSpan(`${request.method} ${url.pathname}`, {
					attributes: {
						'http.method': request.method,
						'http.url': request.url,
						'http.target': url.pathname
					}
				});

				return { __argusSpan: span };
			})
			// The response hook also runs after an error: the span ends here, once, keeping the error status.
			.onAfterResponse('global', ({ __argusSpan, request }) => {
				if (__argusSpan) {
					if (!failed.has(__argusSpan)) __argusSpan.setStatus({ code: SpanStatusCode.OK });
					__argusSpan.setAttribute('http.method', request.method);
					__argusSpan.end();
				}
			})
			.onError('global', (c) => {
				// The error may come before the derive hook ran, so the span can be missing.
				const { __argusSpan, error } = c as typeof c & { __argusSpan?: Span };
				if (__argusSpan) {
					__argusSpan.setStatus({
						code: SpanStatusCode.ERROR,
						message: error instanceof Error ? error.message : 'Unknown error'
					});
					if (error instanceof Error) {
						__argusSpan.recordException(error);
					}
					failed.add(__argusSpan);
				}
			})
	);
};
