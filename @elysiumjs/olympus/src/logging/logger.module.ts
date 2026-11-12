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
import type { PortDriverName } from '../port';
import type { LoggerConfig } from './types';

import { Logger, LOGGER_SERVICE } from '../logger';
import { Module } from '../module';

import './services/json-console.logger';

import { DEFAULT_CONFIG } from './types';

/**
 * `pino` when `@elysiumjs/pino` is loaded, except on Cloudflare Workers, where pino's Node
 * streams are not available; `console` otherwise.
 */
const defaultTransport = (): PortDriverName<'logger'> =>
	Logger.has('pino') && globalThis.navigator?.userAgent !== 'Cloudflare-Workers'
		? ('pino' as PortDriverName<'logger'>)
		: 'console';

/**
 * Provides the application logger as the global `logger` service: the `Logger` driver its
 * `transport` names, built from the module config.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @example
 * ```ts
 * import '@elysiumjs/pino';
 *
 * LoggerModule.with({ level: 'debug', transport: 'pino' });
 * ```
 */
@Module.register<LoggerConfig>({
	services: (config) => [
		{
			name: LOGGER_SERVICE,
			global: true,
			factory: () => Logger.for(config.transport ?? defaultTransport(), config)
		}
	]
})
export class LoggerModule extends Module.configurable<LoggerConfig>({
	defaults: { ...DEFAULT_CONFIG }
}) {}
