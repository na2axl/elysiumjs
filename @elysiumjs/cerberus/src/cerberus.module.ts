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

import type { CerberusConfig } from './utils';

import { Module } from '@elysiumjs/core';

import { CerberusMiddleware } from './cerberus.middleware';
import { CERBERUS_CONFIG } from './cerberus.tokens';

/**
 * Configurable module providing the {@link CerberusMiddleware}. Bind a config with
 * `CerberusModule.with({ getSubject, ... })`; the middleware reads it by injection.
 * @author Axel Nana <axel.nana@workbud.com>
 */
@Module.register({
	services: [CerberusMiddleware],
	// `true` also exports the config token, which is what lets importing modules construct
	// the middleware (it injects the config).
	exports: true
})
export class CerberusModule extends Module.configurable<CerberusConfig>({
	required: ['getSubject']
}) {
	/** Stable injection token of the config; it does not depend on the class name. */
	public static override get config(): string {
		return CERBERUS_CONFIG;
	}
}
