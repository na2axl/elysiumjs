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

/**
 * Enriches a log context object with `traceId` and `spanId` from the
 * active OpenTelemetry span.
 *
 * Use this in Hermes log calls to correlate logs with traces:
 *
 * @example
 * ```typescript
 * import { withTraceContext } from '@elysiumjs/argus';
 *
 * logger.info('Processing request', withTraceContext({ userId: '123' }));
 * // Output: { msg: "Processing request", userId: "123", traceId: "abc...", spanId: "def..." }
 * ```
 *
 * @author Axel Nana <ax.lnana@outlook.com>
 * @param ctx The base context to enrich.
 * @returns The context with `traceId` and `spanId` injected if an active span exists.
 */
export function withTraceContext(ctx: Record<string, unknown> = {}): Record<string, unknown> {
	const span = trace.getActiveSpan();
	if (!span) return ctx;

	const spanCtx = span.spanContext();
	return {
		...ctx,
		traceId: spanCtx.traceId,
		spanId: spanCtx.spanId
	};
}
