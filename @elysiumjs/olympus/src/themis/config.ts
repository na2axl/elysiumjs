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

import type { Secret } from '../harpocrates/secret';
import type { Guard, GuardClass } from './auth';
import type { CookieOptions } from './context';
import type { SessionStore } from './session';

/** The service name of the Themis configuration. */
export const THEMIS_CONFIG = 'themis.settings';

/**
 * The configuration of ThemisModule.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type ThemisConfig = {
	/**
	 * The secret that signs the session cookie, encrypts cookie sessions and binds CSRF tokens. At
	 * least 32 random characters, kept out of the code (an environment secret). A function is called
	 * each time the secret is needed, so it can read it from a store bound to the request.
	 */
	secret: Secret;
	/** The sessions. */
	session?: {
		/** Where sessions live. `cookie` keeps the whole session in an encrypted cookie. Defaults to memory. */
		store?: SessionStore | 'cookie';
		/** The session cookie. Its name defaults to `elysium_session`. */
		cookie?: CookieOptions;
		/** How long a session lives without being saved, in seconds. Defaults to 7 days. */
		ttl?: number;
	};
	/**
	 * The guards `@Auth()` can use, by name: guard objects, or guard classes built through the
	 * service container. `@Auth()` without guards tries them all, in order.
	 */
	guards?: Record<string, Guard | GuardClass>;
	/** CSRF protection of cookie sessions. */
	csrf?: {
		/** The header that carries the token. Defaults to `x-csrf-token`. */
		header?: string;
		/** The body field that carries the token. Defaults to `_csrf`. */
		field?: string;
	};
};
