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

import type { TestingHttpApp, TestResponse } from '@elysiumjs/core';
import type { SessionStore } from '../src';

import { Application, Http, Middleware, Module, t } from '@elysiumjs/core';
import { afterEach, describe, expect, it } from 'bun:test';

import {
	apiKeyGuard,
	ApiKeys,
	Auth,
	Csrf,
	CsrfMiddleware,
	Jwt,
	jwtGuard,
	KvSessionStore,
	MemorySessionStore,
	RedisSessionStore,
	Session,
	sessionGuard,
	SessionMiddleware,
	ThemisModule
} from '../src';

const SECRET = 's'.repeat(32);
const JWT_SECRET = 'j'.repeat(32);
const users: Record<string, { id: string; name: string }> = { u1: { id: 'u1', name: 'Ada' } };
let apiKey: { key: string; hash: string };

@Http.controller({ path: '/session' })
class SessionController {
	@Http.post({ path: '/visit' })
	public visit() {
		const session = Session.current();
		const visits = (session.get<number>('visits') ?? 0) + 1;
		session.set('visits', visits);
		return { visits };
	}

	@Http.post({ path: '/flash' })
	public flash() {
		Session.current().flash('notice', 'saved');
		return {};
	}

	@Http.get({ path: '/read' })
	public read() {
		return { notice: Session.current().get('notice') ?? null, csrf: Csrf.token() };
	}

	@Http.post({ path: '/login', body: t.Object({ id: t.String() }) })
	public login(@Http.body() body: { id: string }) {
		Auth.login(body.id);
		return { ok: true };
	}

	@Http.post({ path: '/logout' })
	public logout() {
		Auth.logout();
		return { ok: true };
	}
}

@Http.controller({ path: '/me' })
@Auth()
class MeController {
	@Http.get()
	public me() {
		return { user: Auth.user(), guard: Auth.guard() };
	}

	@Http.get({ path: '/jwt-only' })
	@Auth({ guards: ['jwt'] })
	public jwtOnly() {
		return { guard: Auth.guard() };
	}
}

@Http.controller({ path: '/public' })
class PublicController {
	@Http.get()
	@Auth({ optional: true })
	public show() {
		return { signedIn: Auth.check() };
	}
}

@Module.register({ controllers: [SessionController, MeController, PublicController] })
class AuthModule extends Module {}

const makeApp = (store: SessionStore | 'cookie' = new MemorySessionStore()) => {
	@Application.register({
		modules: [
			ThemisModule.with({
				secret: SECRET,
				session: { store, cookie: { secure: false } },
				guards: {
					session: sessionGuard({ user: (id) => users[id] }),
					jwt: jwtGuard({ secret: JWT_SECRET, user: (claims) => users[claims.sub as string] }),
					apiKey: apiKeyGuard({ find: (hash) => (hash === apiKey.hash ? users.u1 : undefined) })
				}
			}),
			AuthModule
		],
		openapi: false
	})
	@Middleware.register(SessionMiddleware, CsrfMiddleware)
	class App extends Application {}
	return App;
};

/** A minimal cookie jar: keeps the cookies a response sets. */
class Jar {
	readonly cookies = new Map<string, string>();

	public keep(response: TestResponse): TestResponse {
		for (const cookie of response.headers.getSetCookie()) {
			const [pair] = cookie.split(';');
			const [name, value] = pair!.split('=');
			if (cookie.includes('Max-Age=0')) this.cookies.delete(name!);
			else this.cookies.set(name!, value!);
		}
		return response;
	}

	public get header(): string {
		return [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
	}
}

describe('sessions, auth and CSRF', () => {
	let testing: TestingHttpApp | undefined;

	afterEach(async () => {
		await testing?.shutdown();
		testing = undefined;
	});

	const flow = async (store?: SessionStore | 'cookie') => {
		testing = await Application.testing({ app: makeApp(store) });
		const jar = new Jar();
		const http = testing.http;
		const csrf = async () => {
			const response = jar.keep(await http.get('/session/read').header('cookie', jar.header));
			return (await response.json()).csrf as string;
		};
		return { http, jar, csrf };
	};

	for (const [label, store] of [
		['memory', undefined],
		['cookie', 'cookie' as const]
	] as const) {
		it(`keeps data between requests in a ${label} session`, async () => {
			const { http, jar, csrf } = await flow(store);
			const first = jar.keep(await http.post('/session/visit'));
			expect(await first.json()).toEqual({ visits: 1 });
			const cookie = first.headers.getSetCookie()[0]!;
			expect(cookie).toContain('HttpOnly');
			expect(cookie).toContain('SameSite=Lax');

			const token = await csrf();
			const second = jar.keep(
				await http.post('/session/visit').header('cookie', jar.header).header('x-csrf-token', token)
			);
			expect(await second.json()).toEqual({ visits: 2 });
		});
	}

	it('flashes a value for the next request only', async () => {
		const { http, jar, csrf } = await flow();
		jar.keep(await http.get('/session/read'));
		const token = await csrf();
		jar.keep(
			await http.post('/session/flash').header('cookie', jar.header).header('x-csrf-token', token)
		);
		const next = jar.keep(await http.get('/session/read').header('cookie', jar.header));
		expect((await next.json()).notice).toBe('saved');
		const after = jar.keep(await http.get('/session/read').header('cookie', jar.header));
		expect((await after.json()).notice).toBeNull();
	});

	it('ignores a forged session cookie', async () => {
		const { http } = await flow();
		const response = await http
			.post('/session/visit')
			.header('cookie', 'elysium_session=forged.sig');
		expect(await response.json()).toEqual({ visits: 1 });
	});

	it('refuses unsafe requests of a session without the CSRF token', async () => {
		const { http, jar } = await flow();
		jar.keep(await http.post('/session/visit'));
		const refused = await http.post('/session/visit').header('cookie', jar.header);
		expect(refused.status).toBe(403);
		const wrong = await http
			.post('/session/visit')
			.header('cookie', jar.header)
			.header('x-csrf-token', 'nope');
		expect(wrong.status).toBe(403);
	});

	it('logs in with the session guard, regenerating the session id, and logs out', async () => {
		const { http, jar, csrf } = await flow();
		expect((await http.get('/me')).status).toBe(401);

		const token = await csrf();
		const before = jar.cookies.get('elysium_session');
		jar.keep(
			await http
				.post('/session/login')
				.header('cookie', jar.header)
				.header('x-csrf-token', token)
				.json({ id: 'u1' })
		);
		expect(jar.cookies.get('elysium_session')).not.toBe(before);

		const me = await http.get('/me').header('cookie', jar.header);
		expect(await me.json()).toEqual({ user: users.u1, guard: 'session' });
		expect((await (await http.get('/public').header('cookie', jar.header)).json()).signedIn).toBe(
			true
		);

		const token2 = await csrf();
		const out = jar.keep(
			await http.post('/session/logout').header('cookie', jar.header).header('x-csrf-token', token2)
		);
		expect(out.headers.getSetCookie()[0]).toContain('Max-Age=0');
		expect((await http.get('/me').header('cookie', jar.header)).status).toBe(401);
	});

	it('authenticates bearer tokens and API keys, and limits a route to some guards', async () => {
		const { http } = await flow();
		apiKey = await ApiKeys.generate({ prefix: 'sk' });
		const token = await Jwt.sign({}, { secret: JWT_SECRET, subject: 'u1' });

		expect(await (await http.get('/me').header('authorization', `Bearer ${token}`)).json()).toEqual(
			{
				user: users.u1,
				guard: 'jwt'
			}
		);
		expect(await (await http.get('/me').header('x-api-key', apiKey.key)).json()).toMatchObject({
			guard: 'apiKey'
		});
		expect((await http.get('/me').header('x-api-key', 'sk_wrong')).status).toBe(401);
		expect((await http.get('/me/jwt-only').header('x-api-key', apiKey.key)).status).toBe(401);
		expect((await http.get('/me').header('authorization', 'Bearer a.b.c')).status).toBe(401);
		expect((await (await http.get('/public')).json()).signedIn).toBe(false);
	});
});

describe('session stores', () => {
	it('keeps sessions in Redis with an expiry', async () => {
		const calls: unknown[][] = [];
		const values = new Map<string, string>();
		const redis = {
			async send(command: string, args: string[]) {
				calls.push([command, ...args]);
				values.set(args[0]!, args[1]!);
			},
			get: async (key: string) => values.get(key) ?? null,
			del: async (key: string) => Number(values.delete(key))
		};
		const store = new RedisSessionStore({ connection: () => redis as never });
		await store.save('id', { a: 1 }, 60);
		expect(calls).toEqual([['SET', 'session:id', '{"a":1}', 'EX', '60']]);
		expect(await store.load('id')).toEqual({ a: 1 });
		await store.destroy('id');
		expect(await store.load('id')).toBeNull();
	});

	it('keeps sessions in Workers KV, with at least the KV minimum expiry', async () => {
		const puts: unknown[] = [];
		const values = new Map<string, string>();
		const kv = {
			get: async (key: string) => values.get(key) ?? null,
			async put(key: string, value: string, options?: { expirationTtl?: number }) {
				puts.push(options);
				values.set(key, value);
			},
			delete: async (key: string) => void values.delete(key)
		};
		const store = new KvSessionStore({ namespace: kv, prefix: 's:' });
		await store.save('id', { b: 2 }, 10);
		expect(puts).toEqual([{ expirationTtl: 60 }]);
		expect(await store.load('id')).toEqual({ b: 2 });
		await store.destroy('id');
		expect(await store.load('id')).toBeNull();
	});

	it('expires memory sessions', async () => {
		const store = new MemorySessionStore();
		await store.save('id', { c: 3 }, -1);
		expect(await store.load('id')).toBeNull();
	});
});
