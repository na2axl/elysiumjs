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
import type { HermesConfig } from './types';

import { LOGGER_SERVICE, Module } from '@elysiumjs/core';

import { JsonConsoleLogger } from './services/json-console.logger';
import { HermesLogger } from './services/logger.service';
import { DEFAULT_CONFIG } from './types';

/** `console` on Cloudflare Workers, where pino's Node streams are not available; `pino` elsewhere. */
const defaultTransport = (): 'pino' | 'console' =>
	globalThis.navigator?.userAgent === 'Cloudflare-Workers' ? 'console' : 'pino';

/**
 * Provides the {@link HermesLogger} as global services, by its class and as `logger`
 * (the same instance), built from the module config. With `transport: 'console'` (the default
 * on Cloudflare Workers), `logger` is a {@link JsonConsoleLogger} instead.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
@Module.register<HermesConfig>({
	services: (config) => [
		{ name: HermesLogger, global: true, factory: () => new HermesLogger(config) },
		{
			name: LOGGER_SERVICE,
			global: true,
			factory: (_config, get) =>
				(config.transport ?? defaultTransport()) === 'console'
					? new JsonConsoleLogger(config)
					: get<HermesLogger>(HermesLogger)
		}
	]
})
export class HermesModule extends Module.configurable<HermesConfig>({
	defaults: { ...DEFAULT_CONFIG }
}) {}
