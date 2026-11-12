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

import type { TestingHttpApp } from '../../src/index';
import type { PasskeyRecord } from '../../src/themis';

import { Application, Http, Middleware, Module } from '../../src/index';
import { afterEach, describe, expect, it } from 'bun:test';

import {
	BackupCodes,
	Jwt,
	OAuthClient,
	Passkeys,
	PasskeyVerificationError,
	SessionMiddleware,
	ThemisModule,
	Totp
} from '../../src/themis';

describe('TOTP', () => {
	// RFC 6238, appendix B: the ASCII secret 12345678901234567890.
	const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

	it('computes the RFC 6238 codes', async () => {
		expect(await Totp.generate(secret, { time: 59_000, digits: 8 })).toBe('94287082');
		expect(await Totp.generate(secret, { time: 1_111_111_109_000, digits: 8 })).toBe('07081804');
		expect(await Totp.generate(secret, { time: 20_000_000_000_000, digits: 8 })).toBe('65353130');
	});

	it('verifies a code within the window, and returns its counter', async () => {
		const time = 1_700_000_000_000;
		const previous = await Totp.generate(secret, { time: time - 30_000 });
		expect(await Totp.verify(previous, secret, { time })).toBe(Math.floor(time / 30_000) - 1);
		expect(await Totp.verify(previous, secret, { time, window: 0 })).toBeNull();
		expect(await Totp.verify('12345', secret, { time })).toBeNull();
		expect(await Totp.verify('abcdef', secret, { time })).toBeNull();
	});

	it('generates base32 secrets and otpauth URIs', async () => {
		const generated = Totp.generateSecret();
		expect(generated).toMatch(/^[A-Z2-7]{32}$/);
		expect(await Totp.verify(await Totp.generate(generated), generated)).not.toBeNull();
		expect(Totp.uri({ secret: generated, issuer: 'Klapzi', account: 'ada@example.com' })).toBe(
			`otpauth://totp/Klapzi:ada%40example.com?secret=${generated}&issuer=Klapzi&algorithm=SHA1&digits=6&period=30`
		);
		expect(() => Totp.generate('not base32!')).toThrow('base32');
	});
});

describe('backup codes', () => {
	it('generates codes, and uses each of them once', async () => {
		const { codes, hashes } = await BackupCodes.generate(3);
		expect(codes).toHaveLength(3);
		expect(codes[0]).toMatch(/^[2-9a-z]{5}-[2-9a-z]{5}$/);

		const used = await BackupCodes.consume(codes[1]!.toUpperCase().replace('-', ' '), hashes);
		expect(used).toEqual({ valid: true, used: hashes[1], remaining: [hashes[0]!, hashes[2]!] });
		expect((await BackupCodes.consume(codes[1]!, used.remaining)).valid).toBe(false);
	});

	it('hashes with a key when given one, and needs the same key to use a code', async () => {
		const secret = 'k'.repeat(32);
		const plain = await BackupCodes.generate(1);
		const keyed = await BackupCodes.generate(1, { secret: () => secret });
		expect(keyed.hashes[0]).not.toMatch(/^[0-9a-f]{64}$/);
		expect(plain.hashes[0]).toMatch(/^[0-9a-f]{64}$/);

		expect((await BackupCodes.consume(keyed.codes[0]!, keyed.hashes)).valid).toBe(false);
		const other = { secret: 'o'.repeat(32) };
		expect((await BackupCodes.consume(keyed.codes[0]!, keyed.hashes, other)).valid).toBe(false);
		expect((await BackupCodes.consume(keyed.codes[0]!, keyed.hashes, { secret })).valid).toBe(true);
	});

	it('refuses a short key', async () => {
		await expect(BackupCodes.generate(1, { secret: 'short' })).rejects.toThrow();
	});
});

describe('passkeys with challenges kept by the app', () => {
	const stored: PasskeyRecord = {
		id: 'cred-1',
		userId: 'u1',
		publicKey: 'AQID',
		counter: 0,
		backedUp: false,
		deviceType: 'singleDevice'
	};
	const keys = new Passkeys({
		rpName: 'Klapzi',
		rpID: 'example.com',
		origin: 'https://example.com',
		challenges: 'caller',
		repository: {
			forUser: async (userId) => (userId === stored.userId ? [stored] : []),
			find: async (id) => (id === stored.id ? stored : undefined),
			save: async () => {},
			updateCounter: async () => false
		}
	});
	const answer = (id: string) => ({ id, rawId: id, response: {}, type: 'public-key' }) as never;

	it('issues options outside any session', async () => {
		const options = await keys.registrationOptions({ id: 'u1', name: 'ada' });
		expect(options.excludeCredentials).toEqual([{ id: 'cred-1', type: 'public-key' }]);
		const login = await keys.authenticationOptions({ id: 'u1' });
		expect(typeof login.challenge).toBe('string');
	});

	it('refuses an answer without the challenge, or a registration without its user', async () => {
		await expect(keys.verifyRegistration(answer('x'))).rejects.toThrow('no registration');
		await expect(keys.verifyRegistration(answer('x'), { challenge: 'c' })).rejects.toThrow(
			'no registration'
		);
		await expect(keys.verifyAuthentication(answer('cred-1'))).rejects.toThrow('no sign-in');
	});

	it('passes the timeout and the resident key requirement to the client', async () => {
		const strict = new Passkeys({
			rpName: 'Klapzi',
			rpID: 'example.com',
			origin: 'https://example.com',
			challenges: 'caller',
			residentKey: 'required',
			userVerification: 'required',
			timeout: 300_000,
			repository: {
				forUser: async () => [],
				find: async () => undefined,
				save: async () => {},
				updateCounter: async () => {}
			}
		});
		const options = await strict.registrationOptions({ id: 'u1', name: 'ada' });
		expect(options.timeout).toBe(300_000);
		expect(options.authenticatorSelection).toMatchObject({
			residentKey: 'required',
			userVerification: 'required'
		});
		expect((await strict.authenticationOptions()).timeout).toBe(300_000);
	});

	it('refuses a user handle of another user', async () => {
		const handle = btoa('u2').replace(/=+$/, '');
		const forged = {
			id: 'cred-1',
			rawId: 'cred-1',
			response: { userHandle: handle },
			type: 'public-key'
		} as never;
		await expect(keys.verifyAuthentication(forged, { challenge: 'c' })).rejects.toThrow(
			'another user'
		);
	});

	it("reads another user's passkey as an unknown one", async () => {
		await expect(
			keys.verifyAuthentication(answer('cred-1'), { challenge: 'c', userId: 'u2' })
		).rejects.toThrow('unknown');
		await expect(
			keys.verifyAuthentication(answer('cred-1'), { challenge: 'c', userId: 'u1' })
		).rejects.toThrow(PasskeyVerificationError);
	});
});

const ISSUER = 'https://id.example.com';
const CLIENT = 'client-1';

const signingKey = crypto.subtle.generateKey(
	{
		name: 'RSASSA-PKCS1-v1_5',
		modulusLength: 2048,
		publicExponent: new Uint8Array([1, 0, 1]),
		hash: 'SHA-256'
	},
	true,
	['sign', 'verify']
) as Promise<CryptoKeyPair>;

/** A provider that answers discovery, the token request and the user info. */
const provider = () => {
	const seen: { url: string; body?: string }[] = [];
	let nonce = '';
	const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input instanceof Request ? input.url : input);
		const body = init?.body ? String(init.body) : undefined;
		seen.push({ url, body });
		if (url.endsWith('/.well-known/openid-configuration')) {
			return Response.json({
				issuer: ISSUER,
				authorization_endpoint: `${ISSUER}/authorize`,
				token_endpoint: `${ISSUER}/token`,
				userinfo_endpoint: `${ISSUER}/userinfo`,
				jwks_uri: `${ISSUER}/jwks`
			});
		}
		if (url.endsWith('/token')) {
			const idToken = await Jwt.sign(
				{ nonce, email: 'ada@example.com' },
				{
					key: (await signingKey).privateKey,
					algorithm: 'RS256',
					issuer: ISSUER,
					audience: CLIENT,
					subject: 'sub-1',
					expiresIn: 60
				}
			);
			return Response.json({ access_token: 'at', token_type: 'Bearer', id_token: idToken });
		}
		if (url.endsWith('/userinfo')) return Response.json({ sub: 'sub-1', name: 'Ada' });
		return new Response('not found', { status: 404 });
	}) as typeof fetch;
	return { fetcher, seen, setNonce: (value: string) => (nonce = value) };
};

describe('OAuth and passkeys over HTTP', () => {
	let testing: TestingHttpApp | undefined;

	afterEach(async () => {
		await testing?.shutdown();
		testing = undefined;
	});

	const passkeys: PasskeyRecord[] = [
		{
			id: 'cred-1',
			userId: 'u1',
			publicKey: 'AQID',
			counter: 0,
			backedUp: false,
			deviceType: 'singleDevice'
		}
	];

	const setup = async () => {
		const idp = provider();
		const client = new OAuthClient({
			issuer: ISSUER,
			clientId: CLIENT,
			clientSecret: 'secret',
			redirectUri: 'https://app.example.com/callback',
			fetch: idp.fetcher
		});
		const keys = new Passkeys({
			rpName: 'Klapzi',
			rpID: 'example.com',
			origin: 'https://example.com',
			repository: {
				forUser: async (userId) => passkeys.filter((p) => p.userId === userId),
				find: async (id) => passkeys.find((p) => p.id === id),
				save: async (record) => void passkeys.push(record),
				updateCounter: async () => {}
			}
		});

		@Http.controller('/auth')
		class AuthController {
			@Http.get('/start')
			public async start() {
				return { url: String(await client.authorize({ prompt: 'consent' })) };
			}

			@Http.get('/callback')
			public async callback(@Http.context() c: { request: Request }) {
				const { claims, userInfo, tokens } = await client.callback(c.request.url);
				return {
					sub: claims?.sub,
					email: claims?.email,
					name: userInfo?.name,
					token: tokens.access_token
				};
			}

			@Http.get('/passkey/register')
			public register() {
				return keys.registrationOptions({ id: 'u1', name: 'ada' });
			}

			@Http.post('/passkey/register')
			public verifyRegister(@Http.body() body: never) {
				return keys.verifyRegistration(body);
			}

			@Http.get('/passkey/login')
			public login() {
				return keys.authenticationOptions({ id: 'u1' });
			}

			@Http.post('/passkey/login')
			public verifyLogin(@Http.body() body: never) {
				return keys.verifyAuthentication(body);
			}
		}

		@Module.register({ controllers: [AuthController] })
		class AuthModule extends Module {}

		@Application.register({
			modules: [
				ThemisModule.with({ secret: 's'.repeat(32), session: { cookie: { secure: false } } }),
				AuthModule
			],
			openapi: false
		})
		@Middleware.register(SessionMiddleware)
		class App extends Application {}

		testing = await Application.testing({ app: App });
		let cookie = '';
		const keep = (response: Response) => {
			const set = response.headers.getSetCookie()[0];
			if (set) cookie = set.split(';')[0]!;
			return response;
		};
		const get = async (path: string) =>
			keep(await testing!.http.get(path).header('cookie', cookie));
		const post = async (path: string, body: unknown) =>
			keep(await testing!.http.post(path).header('cookie', cookie).json(body));
		return { idp, get, post };
	};

	it('signs in with OpenID Connect: state, PKCE, nonce, code exchange and user info', async () => {
		const { idp, get } = await setup();
		const start = new URL((await (await get('/auth/start')).json()).url);
		expect(start.origin + start.pathname).toBe(`${ISSUER}/authorize`);
		expect(start.searchParams.get('code_challenge_method')).toBe('S256');
		expect(start.searchParams.get('scope')).toBe('openid email profile');
		expect(start.searchParams.get('prompt')).toBe('consent');
		idp.setNonce(start.searchParams.get('nonce')!);

		const state = start.searchParams.get('state')!;
		const done = await get(`/auth/callback?code=abc&state=${state}`);
		expect(await done.json()).toEqual({
			sub: 'sub-1',
			email: 'ada@example.com',
			name: 'Ada',
			token: 'at'
		});
		const token = idp.seen.find((call) => call.url.endsWith('/token'))!;
		expect(token.body).toContain('code_verifier=');
		expect(token.body).toContain('client_secret=secret');

		// The pending sign-in is used up.
		expect((await get(`/auth/callback?code=abc&state=${state}`)).status).toBe(400);
	});

	it('refuses a callback with another state', async () => {
		const { get } = await setup();
		await get('/auth/start');
		const response = await get('/auth/callback?code=abc&state=forged');
		expect(response.status).toBe(400);
		expect((await response.json()).detail).toContain('could not be completed');
	});

	it('issues passkey options with the challenge in the session, and refuses bad answers', async () => {
		const { get, post } = await setup();
		expect((await post('/auth/passkey/register', {})).status).toBe(400);

		const options = await (await get('/auth/passkey/register')).json();
		expect(options.rp).toEqual({ name: 'Klapzi', id: 'example.com' });
		expect(options.excludeCredentials).toEqual([{ id: 'cred-1', type: 'public-key' }]);
		const bad = await post('/auth/passkey/register', {
			id: 'x',
			rawId: 'x',
			response: {},
			type: 'public-key'
		});
		expect(bad.status).toBe(400);

		const login = await (await get('/auth/passkey/login')).json();
		expect(login.allowCredentials).toEqual([{ id: 'cred-1', type: 'public-key' }]);
		expect(typeof login.challenge).toBe('string');
		const unknown = await post('/auth/passkey/login', {
			id: 'nope',
			rawId: 'nope',
			response: {},
			type: 'public-key'
		});
		expect((await unknown.json()).detail).toContain('unknown');
	});
});
