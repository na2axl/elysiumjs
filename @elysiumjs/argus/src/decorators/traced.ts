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

import type { SpanOptions } from '@opentelemetry/api';

import { SpanStatusCode, trace } from '@opentelemetry/api';

/**
 * Decorator that wraps a method in an OpenTelemetry span.
 *
 * Creates a child span for each method invocation, recording success
 * or error status. Exceptions are recorded on the span before re-throwing.
 *
 * @example
 * ```typescript
 * class UserService {
 *   @Traced('user.findById')
 *   async findById(id: string) {
 *     return db.query('SELECT * FROM users WHERE id = $1', [id]);
 *   }
 * }
 * ```
 *
 * @author Axel Nana <ax.lnana@outlook.com>
 * @param name Optional span name. Defaults to `ClassName.methodName`.
 * @param options Optional OpenTelemetry span options.
 * @returns A method decorator.
 */
export function Traced(name?: string, options?: SpanOptions): MethodDecorator {
	return function (
		target: object,
		propertyKey: string | symbol,
		descriptor: TypedPropertyDescriptor<any>
	) {
		const original = descriptor.value;
		const spanName = name ?? `${target.constructor.name}.${String(propertyKey)}`;

		descriptor.value = async function (...args: any[]) {
			const tracer = trace.getTracer('@elysiumjs/argus');

			return tracer.startActiveSpan(spanName, options ?? {}, async (span) => {
				try {
					const result = await original.apply(this, args);
					span.setStatus({ code: SpanStatusCode.OK });
					return result;
				} catch (error) {
					span.setStatus({
						code: SpanStatusCode.ERROR,
						message: error instanceof Error ? error.message : 'Unknown error'
					});
					span.recordException(error as Error);
					throw error;
				} finally {
					span.end();
				}
			});
		};

		return descriptor;
	};
}
