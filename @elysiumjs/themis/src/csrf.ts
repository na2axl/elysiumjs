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

import type { ProblemClass } from '@elysiumjs/core';
import type { HttpContext } from './context';

import { Middleware } from '@elysiumjs/core';

import { themisConfig } from './context';
import { randomToken, safeEqual } from './crypto';
import { CsrfTokenMismatchError } from './errors';
import { loadSession, Session } from './session';

const TOKEN = '_csrf';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Protects cookie sessions against cross-site request forgery. Unsafe requests (not `GET`, `HEAD`
 * or `OPTIONS`) that carry a valid session cookie need the session's token in the `x-csrf-token`
 * header or the `_csrf` body field. Requests without one, such as those of bearer tokens, are not
 * checked. Register it after SessionMiddleware.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class CsrfMiddleware extends Middleware {
	/** The problems it answers with, documented on the routes it protects. */
	public static readonly errors: readonly ProblemClass[] = [CsrfTokenMismatchError];

	public override async onBeforeHandle(context: HttpContext): Promise<void> {
		const config = themisConfig();
		const session = await loadSession(context);
		const expected = Csrf.tokenOf(session);
		// Without a valid session cookie, the request cannot act as a session's user.
		if (SAFE_METHODS.has(context.request.method) || session.isNew) return;

		const body = context.body as Record<string, unknown> | undefined;
		const presented =
			context.request.headers.get(config.csrf?.header ?? 'x-csrf-token') ??
			(typeof body?.[config.csrf?.field ?? TOKEN] === 'string'
				? (body[config.csrf?.field ?? TOKEN] as string)
				: undefined);
		if (!presented || !safeEqual(presented, expected)) throw new CsrfTokenMismatchError();
	}
}

export namespace Csrf {
	/** The CSRF token of a session, created on first use. */
	export const tokenOf = (session: Session): string => {
		let token = session.get<string>(TOKEN);
		if (!token) {
			token = randomToken(32);
			session.set(TOKEN, token);
		}
		return token;
	};

	/** The CSRF token of the current session, to put in forms or in a meta tag. */
	export const token = (): string => tokenOf(Session.current());
}
