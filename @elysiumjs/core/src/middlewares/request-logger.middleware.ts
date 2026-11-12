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

import type { Context } from '../http';

import { Middleware } from '../middleware';

/**
 * Middleware that logs incoming HTTP requests and their completion time.
 *
 * Uses `this.logger` which is resolved from the service container.
 * If Hermes is installed, structured JSON logs are produced; otherwise,
 * the fallback `ConsoleLogger` is used.
 *
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class RequestLoggerMiddleware extends Middleware {
	public async onRequest(ctx: Context): Promise<void> {
		(ctx as any).__requestStartTime = Date.now();
		this.logger.info('Incoming request', {
			method: ctx.request.method,
			path: new URL(ctx.request.url).pathname
		});
	}

	public async onAfterResponse(ctx: Context): Promise<void> {
		const duration = Date.now() - ((ctx as any).__requestStartTime ?? 0);
		this.logger.info('Request completed', {
			method: ctx.request.method,
			path: new URL(ctx.request.url).pathname,
			duration: `${duration}ms`
		});
	}
}
