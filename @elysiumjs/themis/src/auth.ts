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

import type { HttpContext } from './context';
import type { JwtVerifyOptions } from './jwt';

import { Metadata, Middleware } from '@elysiumjs/core';

import { ApiKeys } from './api-keys';
import { currentContext, themisConfig } from './context';
import { UnauthenticatedError, UnknownGuardError } from './errors';
import { Jwt } from './jwt';
import { loadSession, Session } from './session';

/**
 * Finds the user of a request, or answers `undefined` when the request does not carry what the
 * guard reads. A guard throws to refuse a request that carries invalid credentials.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export interface Guard {
	authenticate(context: HttpContext): Promise<unknown> | unknown;
}

const USER = 'currentUser';
const GUARD = 'themis:guard';
const SESSION_USER = 'auth:user';

/**
 * A guard that reads the user id kept in the session at login (`Auth.login()`).
 * @author Axel Nana <axel.nana@workbud.com>
 * @param options Loads the user of an id. Without it, the user is the id.
 */
export const sessionGuard = (options: { user?: (id: string) => unknown } = {}): Guard => ({
	async authenticate(context) {
		const id = (await loadSession(context)).get<string>(SESSION_USER);
		if (id === undefined) return undefined;
		return options.user ? options.user(id) : id;
	}
});

/** The token of an `Authorization: Bearer` header. */
const bearer = (request: Request): string | undefined => {
	const header = request.headers.get('authorization');
	const match = header ? /^Bearer\s+(\S+)$/i.exec(header) : null;
	return match?.[1];
};

/**
 * A guard that verifies a JSON Web Token from the `Authorization: Bearer` header.
 * @author Axel Nana <axel.nana@workbud.com>
 * @param options The key and the claims the token must carry, and a loader of the user from the
 * claims. Without it, the user is the claims.
 */
export const jwtGuard = (
	options: JwtVerifyOptions & { user?: (claims: Record<string, unknown>) => unknown }
): Guard => ({
	async authenticate(context) {
		const token = bearer(context.request);
		if (!token || token.split('.').length !== 3) return undefined;
		const claims = await Jwt.verify(token, options);
		return options.user ? options.user(claims) : claims;
	}
});

/**
 * A guard that finds the user of an API key, from a header (`x-api-key` by default) or the
 * `Authorization: Bearer` header.
 * @author Axel Nana <axel.nana@workbud.com>
 * @param options Finds the user of a key from its hash (`ApiKeys.hash()`), and the header.
 */
export const apiKeyGuard = (options: {
	find: (hash: string) => unknown;
	header?: string;
	/** Only bearer tokens with this prefix are API keys, such as `sk`. */
	prefix?: string;
}): Guard => ({
	async authenticate(context) {
		const fromHeader = context.request.headers.get(options.header ?? 'x-api-key') ?? undefined;
		const fromBearer = bearer(context.request);
		const key =
			fromHeader ??
			(fromBearer && (!options.prefix || fromBearer.startsWith(`${options.prefix}_`))
				? fromBearer
				: undefined);
		if (!key) return undefined;
		const user = await options.find(await ApiKeys.hash(key));
		if (user === undefined || user === null) throw new UnauthenticatedError();
		return user;
	}
});

/**
 * The options of `@Auth()`.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type AuthOptions = {
	/** The guards to try, in order, by their names in ThemisModule. Defaults to all of them. */
	guards?: string[];
	/** Lets requests without a user through; `Auth.user()` is then `undefined`. */
	optional?: boolean;
};

const AUTH_OPTIONS = Symbol.for('elysium:themis:auth');

/**
 * Authenticates the requests of a route or a controller with the guards of ThemisModule, and puts
 * the user in the request (`Auth.user()`, and `currentUser` in the context, which cerberus can
 * read with `getSubject: (ctx) => ctx.currentUser`).
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class AuthMiddleware extends Middleware {
	public override async onBeforeHandle(context: HttpContext): Promise<void> {
		const options = (Metadata.get(AUTH_OPTIONS, this.constructor) ?? {}) as AuthOptions;
		const guards = themisConfig().guards ?? {};
		const names = options.guards ?? Object.keys(guards);
		for (const name of names) {
			const guard = guards[name];
			if (!guard) throw new UnknownGuardError(name);
			const user = await guard.authenticate(context);
			if (user !== undefined && user !== null) {
				context[USER] = user;
				context[GUARD] = name;
				return;
			}
		}
		if (!options.optional) throw new UnauthenticatedError();
	}
}

/**
 * Requires an authenticated user on a route, or on every route of a controller. Requests without
 * one get a 401 problem, unless `optional` is set.
 * @author Axel Nana <axel.nana@workbud.com>
 * @param options The guards to try, and whether the user is optional.
 * @example
 * ```ts
 * @Http.controller({ path: '/me' })
 * @Auth()
 * class MeController {
 * 	@Http.get()
 * 	public show() {
 * 		return Auth.user<User>();
 * 	}
 *
 * 	@Http.get({ path: '/tokens' })
 * 	@Auth({ guards: ['jwt'] })
 * 	public tokens() {}
 * }
 * ```
 */
export function Auth(options: AuthOptions = {}): ClassDecorator & MethodDecorator {
	class ConfiguredAuthMiddleware extends AuthMiddleware {}
	Metadata.define(AUTH_OPTIONS, options, ConfiguredAuthMiddleware);
	return Middleware.register(ConfiguredAuthMiddleware);
}

export namespace Auth {
	/** The user of the current request, if any. */
	export const user = <T = unknown>(): T | undefined => currentContext()?.[USER] as T | undefined;

	/** The name of the guard that found the user of the current request. */
	export const guard = (): string | undefined => currentContext()?.[GUARD] as string | undefined;

	/** Whether the current request has a user. */
	export const check = (): boolean => user() !== undefined;

	/**
	 * Logs a user in for the session guard: gives the session a new id, against session fixation,
	 * and keeps the user id in it.
	 * @param id The user id.
	 */
	export const login = (id: string): void => {
		const session = Session.current();
		session.regenerate();
		session.set(SESSION_USER, id);
	};

	/** Logs the user of the session out, ending the session. */
	export const logout = (): void => {
		Session.current().destroy();
	};
}
