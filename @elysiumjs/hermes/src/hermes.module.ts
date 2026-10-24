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

import { Module } from '@elysiumjs/core';

import { HermesLogger } from './services/logger.service';
import { DEFAULT_CONFIG, type HermesConfig } from './types';

/**
 * Provides the {@link HermesLogger} as the global services `HermesLogger` and `logger`
 * (the same instance), built from the module config.
 * @author Axel Nana <axel.nana@workbud.com>
 */
@Module.register<HermesConfig>({
	services: (config) => [
		{ name: HermesLogger.name, global: true, factory: () => new HermesLogger(config) },
		{
			name: 'logger',
			global: true,
			factory: (_config: unknown, get: <T>(name: string) => T) => get<HermesLogger>(HermesLogger.name)
		}
	]
})
export class HermesModule extends Module.configurable<HermesConfig>({
	defaults: { ...DEFAULT_CONFIG }
}) {}
