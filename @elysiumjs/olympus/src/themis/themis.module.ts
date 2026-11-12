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

import type { ThemisConfig } from './config';

import { Module } from '../index';

import { THEMIS_CONFIG } from './config';
import { assertStrongSecret } from './errors';

/**
 * Configures Themis: the secret, the sessions and the guards of `@Auth()`.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @example
 * ```ts
 * ThemisModule.with({
 * 	secret: env.APP_SECRET,
 * 	session: { store: new RedisSessionStore({ connection: () => Redis.connection() }) },
 * 	guards: {
 * 		session: sessionGuard({ user: (id) => users.find(id) }),
 * 		jwt: jwtGuard({ secret: env.JWT_SECRET })
 * 	}
 * });
 * ```
 */
@Module.register<ThemisConfig>({
	services: (config) => {
		if (typeof config.secret === 'string') assertStrongSecret(config.secret, 'themis secret');
		return [{ name: THEMIS_CONFIG, global: true, factory: () => config }];
	}
})
export class ThemisModule extends Module.configurable<ThemisConfig>({ required: ['secret'] }) {}
