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

import type { HttpContext } from './context';

import { Clock, currentEnvironment, getLogger, Middleware } from '../index';

import { currentContext, readCookie, themisConfig, writeCookie } from './context';
import { decrypt, encrypt, hmac, randomToken, verifyHmac } from './crypto';
import { NoSessionError, SessionTooLargeError } from './errors';
import { resolveSecret } from './secret';

/** The data of a session. */
export type SessionData = Record<string, unknown>;

/**
 * Where server-side sessions live, by id.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export interface SessionStore {
	load(id: string): Promise<SessionData | null>;
	save(id: string, data: SessionData, ttlSeconds: number): Promise<void>;
	destroy(id: string): Promise<void>;
}

/**
 * Keeps sessions in the memory of the process, for tests and single-process apps.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class MemorySessionStore implements SessionStore {
	readonly #sessions = new Map<string, { data: string; expiresAt: number }>();

	public async load(id: string): Promise<SessionData | null> {
		const entry = this.#sessions.get(id);
		if (!entry) return null;
		if (entry.expiresAt <= Clock.epochMs()) {
			this.#sessions.delete(id);
			return null;
		}
		return JSON.parse(entry.data) as SessionData;
	}

	public async save(id: string, data: SessionData, ttlSeconds: number): Promise<void> {
		this.#sessions.set(id, {
			data: JSON.stringify(data),
			expiresAt: Clock.epochMs() + ttlSeconds * 1000
		});
	}

	public async destroy(id: string): Promise<void> {
		this.#sessions.delete(id);
	}
}

/** What the themis secret is called in errors. */
const SECRET = 'themis secret';

const FLASH = '_flash';
const SESSION = 'themis:session';
const DEFAULT_TTL = 7 * 24 * 3600;
const defaultStore = new MemorySessionStore();
let warned = false;

/** The configured store, or the process memory store, with a warning outside tests. */
const storeOf = (config: ReturnType<typeof themisConfig>): SessionStore | 'cookie' => {
	const store = config.session?.store;
	if (store) return store;
	if (!warned && currentEnvironment() !== 'test') {
		warned = true;
		getLogger().warn(
			'Sessions live in the memory of this process: they are lost on restart and not shared ' +
				'between instances. Set session.store in ThemisModule.with().'
		);
	}
	return defaultStore;
};

/** The largest cookie session browsers keep, in characters. */
const MAX_COOKIE_SESSION = 4000;

/**
 * The session of a request: data kept between the requests of one client, behind a cookie. Read
 * it with `Session.current()` in handlers and services; SessionMiddleware loads it and saves it
 * once the handler has run.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class Session {
	#data: SessionData;
	#flashed: SessionData;
	#dirty = false;
	#destroyed = false;
	#previousId: string | null = null;

	constructor(
		public id: string,
		data: SessionData,
		/** Whether the client sent no valid session. */
		public readonly isNew: boolean
	) {
		const { [FLASH]: flashed, ...rest } = data;
		this.#data = rest;
		this.#flashed = (flashed as SessionData | undefined) ?? {};
		if (flashed !== undefined) this.#dirty = true;
	}

	/**
	 * The session of the current request.
	 * @throws {NoSessionError} Outside a request, or when no SessionMiddleware loaded it.
	 */
	public static current(): Session {
		const session = currentContext()?.[SESSION] as Session | undefined;
		if (!session) throw new NoSessionError();
		return session;
	}

	/** A value, or a flashed value of the previous request. */
	public get<T = unknown>(key: string): T | undefined {
		return (key in this.#data ? this.#data[key] : this.#flashed[key]) as T | undefined;
	}

	public has(key: string): boolean {
		return key in this.#data || key in this.#flashed;
	}

	public set(key: string, value: unknown): void {
		this.#data[key] = value;
		this.#dirty = true;
	}

	public forget(key: string): void {
		if (!(key in this.#data)) return;
		delete this.#data[key];
		this.#dirty = true;
	}

	/** A value and its removal. */
	public pull<T = unknown>(key: string): T | undefined {
		const value = this.get<T>(key);
		this.forget(key);
		return value;
	}

	/** Keeps a value for the next request only, such as a message after a redirect. */
	public flash(key: string, value: unknown): void {
		const flash = ((this.#data[FLASH] as SessionData | undefined) ??= {});
		flash[key] = value;
		this.#dirty = true;
	}

	/** Every value. */
	public all(): SessionData {
		const { [FLASH]: _, ...data } = this.#data;
		return { ...this.#flashed, ...data };
	}

	/** Gives the session a new id, keeping its data. Call it at login, against session fixation. */
	public regenerate(): void {
		this.#previousId ??= this.isNew ? null : this.id;
		this.id = randomToken(32);
		this.#dirty = true;
	}

	/** Ends the session: its data is deleted and the cookie cleared. */
	public destroy(): void {
		this.#destroyed = true;
		this.#data = {};
		this.#flashed = {};
	}

	/** @internal What the middleware saves. */
	public get state() {
		return {
			data: this.#data,
			dirty: this.#dirty,
			destroyed: this.#destroyed,
			previousId: this.#previousId
		};
	}
}

const COOKIE_PURPOSE = 'session-cookie';

/**
 * Loads the session of a request once, from its cookie. A cookie that does not verify gives a new
 * session.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export const loadSession = async (context: HttpContext): Promise<Session> => {
	const loaded = context[SESSION] as Session | undefined;
	if (loaded) return loaded;
	const config = themisConfig();
	const store = storeOf(config);
	const raw = readCookie(context.request, config.session?.cookie?.name ?? 'elysium_session');

	let session: Session | undefined;
	if (raw && store === 'cookie') {
		const opened = await decrypt(await resolveSecret(config.secret, SECRET), COOKIE_PURPOSE, raw);
		const parsed = opened
			? (JSON.parse(opened) as { id: string; data: SessionData; exp: number })
			: null;
		if (parsed && parsed.exp > Clock.epochMs())
			session = new Session(parsed.id, parsed.data, false);
	} else if (raw && store !== 'cookie') {
		const dot = raw.lastIndexOf('.');
		const id = raw.slice(0, dot);
		const secret = await resolveSecret(config.secret, SECRET);
		if (dot > 0 && (await verifyHmac(secret, id, raw.slice(dot + 1)))) {
			const data = await store.load(id);
			if (data) session = new Session(id, data, false);
		}
	}
	session ??= new Session(randomToken(32), {}, true);
	context[SESSION] = session;
	return session;
};

/**
 * Saves the session of a request, and sets or clears its cookie.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export const commitSession = async (context: HttpContext): Promise<void> => {
	const session = context[SESSION] as Session | undefined;
	if (!session) return;
	const config = themisConfig();
	const store = storeOf(config);
	const cookie = config.session?.cookie ?? {};
	const name = cookie.name ?? 'elysium_session';
	const ttl = config.session?.ttl ?? DEFAULT_TTL;
	const { data, dirty, destroyed, previousId } = session.state;

	if (store !== 'cookie' && previousId) await store.destroy(previousId);
	if (destroyed) {
		if (store !== 'cookie' && !session.isNew) await store.destroy(session.id);
		if (!session.isNew) writeCookie(context, name, '', { ...cookie, maxAge: 0 });
		return;
	}
	if (!dirty) return;

	const secret = await resolveSecret(config.secret, SECRET);
	if (store === 'cookie') {
		const sealed = await encrypt(
			secret,
			COOKIE_PURPOSE,
			JSON.stringify({ id: session.id, data, exp: Clock.epochMs() + ttl * 1000 })
		);
		if (sealed.length > MAX_COOKIE_SESSION) throw new SessionTooLargeError(sealed.length);
		writeCookie(context, name, sealed, { ...cookie, maxAge: ttl });
		return;
	}
	await store.save(session.id, data, ttl);
	writeCookie(context, name, `${session.id}.${await hmac(secret, session.id)}`, {
		...cookie,
		maxAge: ttl
	});
};

/**
 * Loads the session before the handler, and saves it after, also when the request ends with a
 * client error. Register it on the application, or on the controllers that use sessions.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @example
 * ```ts
 * @Application.register({ modules: [ThemisModule.with({ secret: env.APP_SECRET })] })
 * @Middleware.register(SessionMiddleware)
 * class App extends Application {}
 * ```
 */
export class SessionMiddleware extends Middleware {
	public override async onBeforeHandle(context: HttpContext): Promise<void> {
		await loadSession(context);
	}

	public override async onAfterHandle(context: HttpContext): Promise<void> {
		await commitSession(context);
	}

	/**
	 * Saves the session of a request refused with a client error too, such as a sign-in followed by
	 * a thrown problem. A server error keeps the session as it was.
	 */
	public override async onError(context: HttpContext & { error: unknown }): Promise<void> {
		const status = Number((context.error as { status?: unknown } | null)?.status ?? 500);
		if (status < 500) await commitSession(context);
	}
}
