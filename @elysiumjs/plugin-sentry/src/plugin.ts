// Copyright (c) 2025-present Workbud Technologies Inc. All rights reserved.
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

import type { Application, ElysiumPlugin } from '@elysiumjs/core';

import { opentelemetry } from '@elysiajs/opentelemetry';
import { Env } from '@elysiumjs/core';
import * as Sentry from '@sentry/bun';
import { Elysia } from 'elysia';

/**
 * Elysium plugin for Sentry integration.
 * @author Axel Nana <axel.nana@workbud.com>
 * @param options Plugin options.
 */
export const plugin = (options?: Sentry.BunOptions): ElysiumPlugin => {
	return async (_app: Application) => {
		const dsn = options?.dsn ?? Env.get('SENTRY_DSN');
		if (!dsn) {
			throw new Error('Must provide a DSN');
		}

		const environment = options?.environment ?? Env.get('SENTRY_ENVIRONMENT');

		Sentry.init({
			dsn,
			environment,
			tracesSampleRate: 1.0,
			integrations: [
				Sentry.bunServerIntegration(),
				Sentry.onUnhandledRejectionIntegration({
					mode: 'warn'
				}),
				Sentry.onUncaughtExceptionIntegration()
			],
			...options
		});

		return (
			new Elysia({
				name: '@elysiumjs/plugin-sentry'
			})
				.decorate('Sentry', Sentry)
				.use(
					opentelemetry({
						serviceName: options?.serverName
					})
				)
				// Capture exceptions
				.onError({ as: 'global' }, ({ error, Sentry }) => {
					Sentry.captureException(error);
				})
				// Need this to inject attributes into the span
				// https://github.com/elysiajs/opentelemetry/issues/40
				.onAfterResponse(
					{ as: 'global' },
					// @ts-expect-error Unused parameters
					function injectAttributes({
						body,
						cookie,
						params,
						request,
						response,
						route,
						server,
						store,
						headers,
						path,
						query
					}) {}
				)
		);
	};
};
