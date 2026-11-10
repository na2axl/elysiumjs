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
import type { AuthUser, Guard, Secret, SessionStore } from '../src';

import { Application, ConflictError, Http, Middleware, Module, Service, t } from '@elysiumjs/core';
import { afterEach, describe, expect, it } from 'bun:test';

import {
	apiKeyGuard,
	ApiKeys,
	Auth,
	AuthMiddleware,
	Csrf,
	CsrfMiddleware,
	Jwt,
	jwtGuard,
	MemorySessionStore,
	Session,
	sessionGuard,
	SessionMiddleware,
	ThemisModule,
	WeakSecretError
} from '../src';

const SECRET = 's'.repeat(32);
const JWT_SECRET = 'j'.repeat(32);
const users: Record<string, { id: string; name: string }> = { u1: { id: 'u1', name: 'Ada' } };
let apiKey: { key: string; hash: string };

@Http.controller('/session')
class SessionController {
	@Http.post('/visit')
	public visit() {
		const session = Session.current();
		const visits = (session.get<number>('visits') ?? 0) + 1;
		session.set('visits', visits);
		return { visits };
	}

	@Http.post('/flash')
	public flash() {
		Session.current().flash('notice', 'saved');
		return {};
	}

	@Http.get('/read')
	public read() {
		return { notice: Session.current().get('notice') ?? null, csrf: Csrf.token() };
	}

	@Http.post('/login', { body: t.Object({ id: t.String() }) })
	public login(@Http.body() body: { id: string }) {
		Auth.login(body.id);
		return { ok: true };
	}

	@Http.post('/login-then-refuse', { body: t.Object({ id: t.String() }) })
	public loginThenRefuse(@Http.body() body: { id: string }) {
		Auth.login(body.id);
		throw new ConflictError('signed in, but refused');
	}

	@Http.post('/big')
	public big() {
		Session.current().set('blob', 'x'.repeat(5000));
		return {};
	}

	@Http.post('/logout')
	public logout() {
		Auth.logout();
		return { ok: true };
	}
}

@Http.controller('/me')
@Auth()
class MeController {
	@Http.get()
	public me() {
		return { user: Auth.currentUser(), guard: Auth.guard() };
	}

	@Http.get('/param')
	public param(@Auth.user() user: AuthUser) {
		return { user, context: Http.currentContext()?.request.url.endsWith('/me/param') };
	}

	@Http.get('/jwt-only')
	@Auth({ guards: ['jwt'] })
	public jwtOnly() {
		return { guard: Auth.guard() };
	}

	@Http.get('/api-key-only')
	@Middleware.register(AuthMiddleware.guards(['apiKey']))
	public apiKeyOnly() {
		return { guard: Auth.guard() };
	}
}

/** A guard class: its constructor gets a service injected. */
class DeviceDirectory {
	public ownerOf(token: string) {
		return token === 'device-1' ? users.u1 : undefined;
	}
}

class DeviceGuard implements Guard {
	constructor(@Service.inject(DeviceDirectory) private readonly devices: DeviceDirectory) {}

	public authenticate(context: { request: Request }) {
		const token = context.request.headers.get('x-device-token');
		return token ? this.devices.ownerOf(token) : undefined;
	}
}

@Http.controller('/device')
class DeviceController {
	@Http.get()
	@Auth({ guards: ['device'] })
	public show() {
		return { user: Auth.currentUser(), guard: Auth.guard() };
	}
}

@Http.controller('/public')
class PublicController {
	@Http.get()
	@Auth({ optional: true })
	public show(@Auth.user() user: AuthUser | undefined) {
		return { signedIn: Auth.check(), user: user ?? null };
	}
}

@Module.register({
	controllers: [SessionController, MeController, PublicController, DeviceController],
	services: [{ name: DeviceDirectory, global: true, factory: () => new DeviceDirectory() }]
})
class AuthModule extends Module {}

const makeApp = (
	store: SessionStore | 'cookie' = new MemorySessionStore(),
	secret: Secret = SECRET
) => {
	@Application.register({
		modules: [
			ThemisModule.with({
				secret,
				session: { store, cookie: { secure: false } },
				guards: {
					session: sessionGuard({ user: (id) => users[id] }),
					jwt: jwtGuard({ secret: JWT_SECRET, user: (claims) => users[claims.sub as string] }),
					apiKey: apiKeyGuard({ find: (hash) => (hash === apiKey.hash ? users.u1 : undefined) }),
					device: DeviceGuard
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
		const token = await Jwt.sign({}, { secret: JWT_SECRET, subject: 'u1', expiresIn: '5m' });

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
		// The guards of core's Middleware.guards() pick the guards too.
		expect(
			await (await http.get('/me/api-key-only').header('x-api-key', apiKey.key)).json()
		).toEqual({ guard: 'apiKey' });
		expect(
			(await http.get('/me/api-key-only').header('authorization', `Bearer ${token}`)).status
		).toBe(401);
		expect((await http.get('/me').header('authorization', 'Bearer a.b.c')).status).toBe(401);
		expect(await (await http.get('/public')).json()).toEqual({ signedIn: false, user: null });
		expect(
			await (await http.get('/me/param').header('authorization', `Bearer ${token}`)).json()
		).toEqual({ user: users.u1, context: true });
	});
});

describe('session edges, guard classes and secrets', () => {
	let testing: TestingHttpApp | undefined;

	afterEach(async () => {
		await testing?.shutdown();
		testing = undefined;
	});

	it('saves the session of a request refused with a client error', async () => {
		testing = await Application.testing({ app: makeApp() });
		const jar = new Jar();
		const http = testing.http;
		const csrf = (await jar.keep(await http.get('/session/read')).json()).csrf as string;
		const refused = jar.keep(
			await http
				.post('/session/login-then-refuse')
				.header('cookie', jar.header)
				.header('x-csrf-token', csrf)
				.json({ id: 'u1' })
		);
		expect(refused.status).toBe(409);
		expect(refused.headers.getSetCookie()[0]).toContain('elysium_session=');
		const me = await http.get('/me').header('cookie', jar.header);
		expect((await me.json()).guard).toBe('session');
	});

	it('takes the CSRF token from the _csrf body field too', async () => {
		testing = await Application.testing({ app: makeApp() });
		const jar = new Jar();
		const http = testing.http;
		const csrf = (await jar.keep(await http.get('/session/read')).json()).csrf as string;
		const visit = await http
			.post('/session/visit')
			.header('cookie', jar.header)
			.json({ _csrf: csrf });
		expect(visit.status).toBe(200);
	});

	it('refuses a cookie session larger than browsers keep', async () => {
		testing = await Application.testing({ app: makeApp('cookie') });
		expect((await testing.http.post('/session/big')).status).toBe(500);
	});

	it('builds a guard class through the container', async () => {
		testing = await Application.testing({ app: makeApp() });
		const response = await testing.http.get('/device').header('x-device-token', 'device-1');
		expect(await response.json()).toEqual({ user: users.u1, guard: 'device' });
		expect((await testing.http.get('/device')).status).toBe(401);
	});

	it('reads the secret from a function on every use', async () => {
		let reads = 0;
		const app = makeApp(undefined, () => {
			reads++;
			return SECRET;
		});
		testing = await Application.testing({ app });
		const jar = new Jar();
		const first = await jar.keep(await testing.http.get('/session/read')).json();
		const second = await (
			await testing.http.get('/session/read').header('cookie', jar.header)
		).json();
		// The second request found the session of the first: its cookie verified.
		expect(second.csrf).toBe(first.csrf);
		expect(reads).toBe(2);
	});

	it('refuses a short secret read from a function when it is used', async () => {
		testing = await Application.testing({ app: makeApp(undefined, async () => 'short') });
		expect((await testing.http.get('/session/read')).status).toBe(500);
	});

	it('refuses secrets shorter than 32 bytes', async () => {
		@Application.register({ modules: [ThemisModule.with({ secret: 'short' })], openapi: false })
		class WeakApp extends Application {}
		await expect(Application.testing({ app: WeakApp })).rejects.toBeInstanceOf(WeakSecretError);
		await expect(Jwt.sign({}, { secret: 'short' })).rejects.toBeInstanceOf(WeakSecretError);
	});
});

describe('session stores', () => {
	it('expires memory sessions', async () => {
		const store = new MemorySessionStore();
		await store.save('id', { c: 3 }, -1);
		expect(await store.load('id')).toBeNull();
	});
});
