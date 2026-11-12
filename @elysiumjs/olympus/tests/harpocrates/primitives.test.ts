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

import { afterEach, describe, expect, it } from 'bun:test';

import {
	InvalidSignatureError,
	InvalidTokenError,
	Jwt,
	Password,
	PasswordHasher,
	Pbkdf2PasswordHasher,
	ScryptPasswordHasher,
	SignedUrl,
	WeakSecretError
} from '../../src/harpocrates';
import {
	decrypt,
	encrypt,
	fromBase64Url,
	safeEqual,
	toBase64Url
} from '../../src/harpocrates/crypto';
import { Clock } from '../../src/index';

describe('crypto helpers', () => {
	it('round-trips base64url and compares strings', () => {
		const bytes = new Uint8Array([0, 250, 251, 252, 253, 254, 255]);
		expect(toBase64Url(bytes)).not.toMatch(/[+/=]/);
		expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes);
		expect(safeEqual('abc', 'abc')).toBe(true);
		expect(safeEqual('abc', 'abd')).toBe(false);
		expect(safeEqual('abc', 'abcd')).toBe(false);
	});

	it('encrypts with a key per secret and purpose, and refuses tampered values', async () => {
		const sealed = await encrypt('s3cret', 'test', 'hello');
		expect(await decrypt('s3cret', 'test', sealed)).toBe('hello');
		expect(await decrypt('other', 'test', sealed)).toBeNull();
		expect(await decrypt('s3cret', 'other', sealed)).toBeNull();
		expect(await decrypt('s3cret', 'test', sealed.slice(0, -2) + 'AA')).toBeNull();
	});
});

describe('passwords', () => {
	afterEach(() => Password.reset());

	it('hashes with scrypt by default, and verifies', async () => {
		const hash = await Password.hash('correct horse');
		expect(hash).toStartWith('$scrypt$N=16384,r=8,p=1$');
		expect(await Password.verify('correct horse', hash)).toBe(true);
		expect(await Password.verify('wrong', hash)).toBe(false);
		expect(Password.needsRehash(hash)).toBe(false);
		expect(Password.hasher()).toBeInstanceOf(ScryptPasswordHasher);
	});

	it('registers scrypt and pbkdf2 as drivers of the PasswordHasher port', () => {
		expect(PasswordHasher.drivers()).toEqual(expect.arrayContaining(['scrypt', 'pbkdf2']));
		expect(PasswordHasher.for('pbkdf2')).toBeInstanceOf(Pbkdf2PasswordHasher);
		Password.use('pbkdf2');
		expect(Password.hasher()).toBeInstanceOf(Pbkdf2PasswordHasher);
	});

	it('recognises the hashes of every registered driver, without registering them', async () => {
		const hash = await new Pbkdf2PasswordHasher().hash('pw');
		expect(await Password.verify('pw', hash)).toBe(true);
		expect(Password.needsRehash(hash)).toBe(true);
	});

	it('answers false when a driver throws', async () => {
		Password.register({
			prefix: '$broken$',
			hash: async () => '$broken$',
			verify: async () => {
				throw new Error('boom');
			},
			needsRehash: () => false
		});
		expect(await Password.verify('pw', '$broken$x')).toBe(false);
	});

	it('hashes with PBKDF2, which every runtime has', async () => {
		expect(new Pbkdf2PasswordHasher().needsRehash('$pbkdf2-sha256$i=100000$AAAA$AAAA')).toBe(true);
		const hasher = new Pbkdf2PasswordHasher({ iterations: 1000 });
		const hash = await hasher.hash('pw');
		expect(hash).toMatch(/^\$pbkdf2-sha256\$i=1000\$[\w-]+\$[\w-]+$/);
		expect(await hasher.verify('pw', hash)).toBe(true);
		expect(await hasher.verify('nope', hash)).toBe(false);
		expect(await hasher.verify('pw', '$pbkdf2-sha256$garbage')).toBe(false);
		expect(hasher.needsRehash(hash)).toBe(false);
		expect(new Pbkdf2PasswordHasher({ iterations: 2000 }).needsRehash(hash)).toBe(true);
	});

	it('hashes with scrypt from node:crypto', async () => {
		const hasher = new ScryptPasswordHasher({ N: 1024 });
		const hash = await hasher.hash('pw');
		expect(hash).toStartWith('$scrypt$N=1024,r=8,p=1$');
		expect(await hasher.verify('pw', hash)).toBe(true);
		expect(await hasher.verify('nope', hash)).toBe(false);
		expect(hasher.needsRehash(hash)).toBe(false);
		expect(new ScryptPasswordHasher().needsRehash(hash)).toBe(true);
	});

	it('verifies the hashes of other hashers and asks to rehash them', async () => {
		const old = await new Pbkdf2PasswordHasher({ iterations: 1000 }).hash('pw');
		Password.use(new ScryptPasswordHasher({ N: 2048 }));
		expect(await Password.verify('pw', old)).toBe(true);
		expect(Password.needsRehash(old)).toBe(true);

		const scrypt = new ScryptPasswordHasher({ N: 1024 });
		Password.register(scrypt);
		expect(await Password.verify('pw', await scrypt.hash('pw'))).toBe(true);
		expect(await Password.verify('pw', '$md5$nope')).toBe(false);
	});
});

describe('JWT', () => {
	it('signs and verifies HS256 tokens with registered claims', async () => {
		const token = await Jwt.sign(
			{ role: 'admin' },
			{ secret: 'k'.repeat(32), subject: 'u1', issuer: 'api', audience: 'app', expiresIn: '5m' }
		);
		const claims = await Jwt.verify(token, {
			secret: 'k'.repeat(32),
			issuer: 'api',
			audience: 'app'
		});
		expect(claims).toMatchObject({ role: 'admin', sub: 'u1', iss: 'api', aud: 'app' });
	});

	it('refuses a bad signature, an expired token and a wrong audience with 401', async () => {
		const secret = 'k'.repeat(32);
		const token = await Jwt.sign({}, { secret, audience: 'app' });
		const bad = await Jwt.verify(token, { secret: 'x'.repeat(32) }).catch((e) => e);
		expect(bad).toBeInstanceOf(InvalidTokenError);
		expect(bad.status).toBe(401);

		const expired = await Jwt.sign({}, { secret, expiresIn: -60 });
		expect(Jwt.verify(expired, { secret })).rejects.toThrow('has expired');
		expect(Jwt.verify(token, { secret, audience: 'other' })).rejects.toBeInstanceOf(
			InvalidTokenError
		);
	});

	it('signs and checks expiries on the application clock', async () => {
		const secret = 'k'.repeat(32);
		try {
			Clock.freeze('2026-01-01T00:00:00Z');
			const token = await Jwt.sign({}, { secret, expiresIn: '5m' });
			expect(await Jwt.verify(token, { secret })).toMatchObject({
				iat: Date.parse('2026-01-01T00:00:00Z') / 1000,
				exp: Date.parse('2026-01-01T00:05:00Z') / 1000
			});
			const link = await SignedUrl.sign('https://x.test/a', { secret, expiresIn: 60 });
			expect(await SignedUrl.verify(link, { secret })).toBe(true);
			Clock.travel(10 * 60 * 1000);
			expect(Jwt.verify(token, { secret })).rejects.toThrow('has expired');
			expect(await SignedUrl.verify(link, { secret })).toBe(false);
		} finally {
			Clock.reset();
		}
	});

	it('signs with asymmetric keys', async () => {
		const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
			'sign',
			'verify'
		])) as CryptoKeyPair;
		const token = await Jwt.sign(
			{ a: 1 },
			{ key: pair.privateKey, algorithm: 'EdDSA', expiresIn: 60 }
		);
		expect(await Jwt.verify(token, { key: pair.publicKey, algorithm: 'EdDSA' })).toMatchObject({
			a: 1
		});
	});
});

describe('JWT keys, claims and clock', () => {
	const current = 'c'.repeat(32);
	const previous = 'p'.repeat(32);

	it('reads a secret from a function, sync or async', async () => {
		const token = await Jwt.sign({}, { secret: async () => current, expiresIn: 60 });
		expect(await Jwt.verify(token, { secret: () => current })).toMatchObject({});
		await expect(Jwt.sign({}, { secret: () => 'short' })).rejects.toBeInstanceOf(WeakSecretError);
	});

	it('tries each key in order, so a token of the previous key verifies during a rotation', async () => {
		const old = await Jwt.sign({ v: 'old' }, { secret: previous, expiresIn: 60 });
		const keys = [{ secret: current }, { secret: previous }];
		expect(await Jwt.verify(old, { keys })).toMatchObject({ v: 'old' });
		const forged = await Jwt.sign({}, { secret: 'f'.repeat(32), expiresIn: 60 });
		expect(Jwt.verify(forged, { keys })).rejects.toThrow('does not verify');
		expect(Jwt.verify(old, { keys: [] })).rejects.toBeInstanceOf(InvalidTokenError);
	});

	it('does not try the next key for an expired token', async () => {
		let previousRead = false;
		const expired = await Jwt.sign({}, { secret: current, expiresIn: -60 });
		const keys = [
			{ secret: current },
			{
				secret: () => {
					previousRead = true;
					return previous;
				}
			}
		];
		expect(Jwt.verify(expired, { keys })).rejects.toThrow('has expired');
		await Jwt.verify(expired, { keys }).catch(() => undefined);
		expect(previousRead).toBe(false);
	});

	it('mixes keys of different algorithms', async () => {
		const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
			'sign',
			'verify'
		])) as CryptoKeyPair;
		const token = await Jwt.sign({}, { key: pair.privateKey, algorithm: 'EdDSA', expiresIn: 60 });
		const keys = [{ secret: current }, { key: pair.publicKey, algorithm: 'EdDSA' }];
		expect(await Jwt.verify(token, { keys })).toMatchObject({});
	});

	it('requires an expiry unless told otherwise, and other claims when asked', async () => {
		const forever = await Jwt.sign({}, { secret: current });
		expect(Jwt.verify(forever, { secret: current })).rejects.toThrow('"exp"');
		expect(await Jwt.verify(forever, { secret: current, requiredClaims: [] })).toMatchObject({});
		const anonymous = await Jwt.sign({}, { secret: current, expiresIn: 60 });
		expect(
			Jwt.verify(anonymous, { secret: current, requiredClaims: ['exp', 'sub'] })
		).rejects.toThrow('"sub"');
	});

	it('signs from an issue time and verifies against a given time', async () => {
		const issuedAt = new Date('2026-01-01T00:00:00Z');
		const token = await Jwt.sign({}, { secret: current, issuedAt, expiresIn: '10m' });
		const at = (iso: string) =>
			Jwt.verify(token, { secret: current, currentDate: new Date(iso), clockTolerance: 0 });
		expect(await at('2026-01-01T00:09:59Z')).toMatchObject({
			iat: issuedAt.getTime() / 1000,
			exp: issuedAt.getTime() / 1000 + 600
		});
		expect(at('2026-01-01T00:10:00Z')).rejects.toThrow('has expired');

		const numeric = await Jwt.sign({}, { secret: current, issuedAt, expiresIn: 90 });
		expect(
			await Jwt.verify(numeric, { secret: current, currentDate: new Date('2026-01-01T00:01:00Z') })
		).toMatchObject({ exp: issuedAt.getTime() / 1000 + 90 });
		await expect(
			Jwt.sign({}, { secret: current, issuedAt, expiresIn: 'ten minutes' })
		).rejects.toBeInstanceOf(TypeError);
	});
});

describe('signed URL secrets', () => {
	it('reads the secret from a function', async () => {
		const secret = () => 's'.repeat(32);
		const link = await SignedUrl.sign('https://x.test/a?b=1', { secret, expiresIn: 60 });
		expect(await SignedUrl.verify(link, { secret })).toBe(true);
		expect(await SignedUrl.verify(link, { secret: () => 't'.repeat(32) })).toBe(false);
	});
});

describe('signed URLs', () => {
	const secret = 'u'.repeat(32);

	it('signs the path and the parameters, not the origin', async () => {
		const link = await SignedUrl.sign('https://api.test/files/1?b=2&a=1', {
			secret,
			expiresIn: 60
		});
		expect(link).toContain('signature=');
		expect(await SignedUrl.verify(link, { secret })).toBe(true);
		expect(
			await SignedUrl.verify(link.replace('https://api.test', 'http://other:8080'), { secret })
		).toBe(true);
		expect(await SignedUrl.verify(link.replace('/files/1', '/files/2'), { secret })).toBe(false);
		expect(await SignedUrl.verify(link.replace('a=1', 'a=9'), { secret })).toBe(false);
		expect(await SignedUrl.verify(link, { secret: 'o'.repeat(32) })).toBe(false);
	});

	it('refuses an expired link with a 403 problem', async () => {
		const link = await SignedUrl.sign('https://api.test/x', { secret, expiresIn: -1 });
		const error = await SignedUrl.assert(link, { secret }).catch((e) => e);
		expect(error).toBeInstanceOf(InvalidSignatureError);
		expect(error.detail).toBe('This link has expired.');
		expect(await SignedUrl.verify('https://api.test/x', { secret })).toBe(false);
	});
});
