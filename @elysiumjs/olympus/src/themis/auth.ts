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

import type { JwtVerifyOptions } from '../harpocrates/jwt';
import type { ProblemClass } from '../index';
import type { HttpContext } from './context';

import { Jwt } from '../harpocrates/jwt';
import { Http, Metadata, Middleware, Service } from '../index';
import { ApiKeys } from './api-keys';
import { currentContext, themisConfig } from './context';
import { UnauthenticatedError, UnknownGuardError } from './errors';
import { loadSession, Session } from './session';

/**
 * Finds the user of a request, or answers `undefined` when the request does not carry what the
 * guard reads. A guard throws to refuse a request that carries invalid credentials.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export interface Guard {
	authenticate(context: HttpContext): Promise<unknown> | unknown;
}

/**
 * A guard class, built once through the service container, so that its constructor gets its
 * services injected like a middleware or a filter.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @example
 * ```ts
 * class DeviceGuard implements Guard {
 * 	constructor(private readonly devices: DeviceRepository) {}
 *
 * 	public async authenticate(context: HttpContext) {
 * 		const token = context.request.headers.get('x-device-token');
 * 		return token ? this.devices.ownerOf(token) : undefined;
 * 	}
 * }
 *
 * ThemisModule.with({ secret, guards: { device: DeviceGuard } });
 * ```
 */
export type GuardClass = new (...args: any[]) => Guard;

const built = new WeakMap<GuardClass, Guard>();

/** The guard of a config entry: the instance, or the class built through the container. */
const guardOf = (entry: Guard | GuardClass): Guard => {
	if (typeof entry !== 'function') return entry;
	let guard = built.get(entry);
	if (!guard) built.set(entry, (guard = Service.make<Guard>(entry)));
	return guard;
};

const USER = 'currentUser';
const GUARD = 'themis:guard';
const SESSION_USER = 'auth:user';

/**
 * A guard that reads the user id kept in the session at login (`Auth.login()`).
 * @author Axel Nana <ax.lnana@outlook.com>
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
 * @author Axel Nana <ax.lnana@outlook.com>
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
 * @author Axel Nana <ax.lnana@outlook.com>
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
 * The user that the guards put in a request, as `Auth.currentUser()` and `@Auth.user()` give it.
 * It is empty until the app declares it, once, for all its guards.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @example
 * ```ts
 * declare module '@elysiumjs/olympus/themis' {
 * 	interface AuthUser {
 * 		id: string;
 * 		roles: string[];
 * 	}
 * }
 * ```
 */
// biome-ignore lint/suspicious/noEmptyInterface: augmented by applications.
export interface AuthUser {}

/**
 * The options of `@Auth()`.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type AuthOptions = {
	/** The guards to try, in order, by their names in ThemisModule. Defaults to all of them. */
	guards?: string[];
	/** Lets requests without a user through; `Auth.currentUser()` is then `undefined`. */
	optional?: boolean;
};

const OPTIONAL = Symbol.for('elysium:themis:auth-optional');

/**
 * Authenticates the requests of a route or a controller with the guards of ThemisModule, and puts
 * the user in the request (`Auth.currentUser()`, which cerberus reads for the actor of a request).
 *
 * It tries the guards named with `AuthMiddleware.guards([...])`, in order, or all of them.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @example
 * ```ts
 * @Middleware.register(AuthMiddleware.guards(['jwt']))
 * class TokensController {}
 * ```
 */
export class AuthMiddleware extends Middleware {
	/** The problems it answers with, documented on the routes it guards. */
	public static errors: readonly ProblemClass[] = [UnauthenticatedError];

	public override async onBeforeHandle(context: HttpContext): Promise<void> {
		const guards = themisConfig().guards ?? {};
		const names = this.guards.length > 0 ? this.guards : Object.keys(guards);
		for (const name of names) {
			const entry = guards[name];
			if (!entry) throw new UnknownGuardError(name);
			const user = await guardOf(entry).authenticate(context);
			if (user !== undefined && user !== null) {
				context[USER] = user;
				context[GUARD] = name;
				return;
			}
		}
		if (Metadata.get(OPTIONAL, this.constructor) !== true) throw new UnauthenticatedError();
	}
}

/**
 * Authenticates a controller or a route with {@link AuthMiddleware}: `guards` names the guards
 * to try, and `optional` lets requests without a user through.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export function Auth(options: AuthOptions = {}): ClassDecorator & MethodDecorator {
	const base = (
		options.guards ? AuthMiddleware.guards(options.guards) : AuthMiddleware
	) as typeof AuthMiddleware;
	class ConfiguredAuthMiddleware extends base {}
	if (options.optional) {
		Metadata.define(OPTIONAL, true, ConfiguredAuthMiddleware);
		ConfiguredAuthMiddleware.errors = [];
	}
	return Middleware.register(ConfiguredAuthMiddleware);
}

export namespace Auth {
	/**
	 * Sets a handler parameter to the user of the request. Behind `@Auth()` the request always has
	 * one, so the parameter is typed `AuthUser`; behind `@Auth({ optional: true })`, type it
	 * `AuthUser | undefined`.
	 * @example
	 * ```ts
	 * @Http.controller('/me')
	 * @Auth()
	 * class MeController {
	 * 	@Http.get('/')
	 * 	public show(@Auth.user() user: AuthUser) {
	 * 		return { id: user.id };
	 * 	}
	 * }
	 * ```
	 */
	export const user = (): ParameterDecorator =>
		Http.decorate((context) => (context as unknown as HttpContext)[USER])();

	/** The user of the current request, if any. */
	export const currentUser = <T = AuthUser>(): T | undefined =>
		currentContext()?.[USER] as T | undefined;

	/** The name of the guard that found the user of the current request. */
	export const guard = (): string | undefined => currentContext()?.[GUARD] as string | undefined;

	/** Whether the current request has a user. */
	export const check = (): boolean => currentUser() !== undefined;

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
