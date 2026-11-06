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

import type { Interceptor, InterceptorContext } from '@elysiumjs/core';

import { getLogger } from '@elysiumjs/core';

/** The status of a thrown error: its own, or 500. */
const statusOf = (error: unknown): number => {
	const status = (error as { status?: unknown } | null)?.status;
	return typeof status === 'number' ? status : 500;
};

/**
 * Writes one structured line per request through the app logger: the method, the path, the route,
 * the status, the duration in milliseconds, the client address and the `x-request-id` header when
 * present. Server errors are logged at `error`, client errors at `warn`, the rest at `info`. Use it
 * as an app interceptor; streaming routes do not run interceptors.
 * @author Axel Nana <axel.nana@workbud.com>
 * @example
 * ```ts
 * @Application.register({ modules: [HermesModule], interceptors: [RequestLogInterceptor] })
 * class App extends Application {}
 * ```
 */
export class RequestLogInterceptor implements Interceptor {
	public async intercept(ctx: InterceptorContext, next: () => Promise<unknown>): Promise<unknown> {
		const started = performance.now();
		const log = (status: number, error?: unknown) => {
			const fields: Record<string, unknown> = {
				method: ctx.request.method,
				path: new URL(ctx.request.url).pathname,
				status,
				durationMs: Math.round((performance.now() - started) * 100) / 100
			};
			if (typeof ctx.route === 'string') fields.route = ctx.route;
			if (typeof ctx.ip === 'string') fields.ip = ctx.ip;
			const requestId = ctx.request.headers.get('x-request-id');
			if (requestId) fields.requestId = requestId;
			if (error !== undefined && status >= 500) fields.error = error;
			const message = `${fields.method} ${fields.path} ${status}`;
			const logger = getLogger();
			if (status >= 500) logger.error(message, fields);
			else if (status >= 400) logger.warn(message, fields);
			else logger.info(message, fields);
		};

		try {
			const result = await next();
			const status = result instanceof Response ? result.status : Number(ctx.set.status ?? 200);
			log(Number.isFinite(status) ? status : 200);
			return result;
		} catch (error) {
			log(statusOf(error), error);
			throw error;
		}
	}
}
