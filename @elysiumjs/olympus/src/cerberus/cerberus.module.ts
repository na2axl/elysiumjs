// Copyright (c) 2025-present Axel Nana <ax.lnana@outlook.com>. All rights reserved.
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
import type { CerberusModuleConfig } from './config';

import { Module } from '../module';
import { CERBERUS_CONFIG, settingsOf } from './config';

/**
 * Gives cerberus the facts of actors, and where their abilities are cached. List the rules of
 * each domain, `@Abilities.rules()` classes, in the services of the domain's module.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @example
 * ```ts
 * CerberusModule.with({
 * 	facts: async (userId) => {
 * 		const user = await users.find(userId);
 * 		return user ? { version: user.abilityVersion, facts: { userId, roles: user.roles } } : null;
 * 	},
 * 	cache: () => Cache.store('kv')
 * });
 * ```
 */
@Module.register<CerberusModuleConfig>({
	services: (config) => [{ name: CERBERUS_CONFIG, global: true, factory: () => settingsOf(config) }]
})
export class CerberusModule extends Module.configurable<CerberusModuleConfig>({
	required: ['facts']
}) {}
