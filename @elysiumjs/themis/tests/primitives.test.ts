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

import { afterEach, describe, expect, it } from 'bun:test';

import {
	ApiKeys,
	BunPasswordHasher,
	InvalidSignatureError,
	InvalidTokenError,
	Jwt,
	Password,
	Pbkdf2PasswordHasher,
	SignedUrl
} from '../src';
import { decrypt, encrypt, fromBase64Url, safeEqual, toBase64Url } from '../src/crypto';
import { ScryptPasswordHasher } from '../src/scrypt';

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

	it('hashes with Argon2id on Bun, and verifies', async () => {
		const hash = await Password.hash('correct horse');
		expect(hash).toStartWith('$argon2id$');
		expect(await Password.verify('correct horse', hash)).toBe(true);
		expect(await Password.verify('wrong', hash)).toBe(false);
		expect(Password.needsRehash(hash)).toBe(false);
	});

	it('hashes with PBKDF2, which every runtime has', async () => {
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
		Password.use(new BunPasswordHasher({ memoryCost: 4096, timeCost: 2 }));
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

	it('signs with asymmetric keys', async () => {
		const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
			'sign',
			'verify'
		])) as CryptoKeyPair;
		const token = await Jwt.sign({ a: 1 }, { key: pair.privateKey, algorithm: 'EdDSA' });
		expect(await Jwt.verify(token, { key: pair.publicKey, algorithm: 'EdDSA' })).toMatchObject({
			a: 1
		});
	});
});

describe('API keys', () => {
	it('generates prefixed keys, and verifies them against their hash', async () => {
		const { key, hash } = await ApiKeys.generate({ prefix: 'sk' });
		expect(key).toMatch(/^sk_[\w-]{43}$/);
		expect(hash).toMatch(/^[0-9a-f]{64}$/);
		expect(await ApiKeys.verify(key, hash)).toBe(true);
		expect(await ApiKeys.verify(`${key}x`, hash)).toBe(false);
	});
});

describe('signed URLs', () => {
	const secret = 'url-secret';

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
		expect(await SignedUrl.verify(link, { secret: 'other' })).toBe(false);
	});

	it('refuses an expired link with a 403 problem', async () => {
		const link = await SignedUrl.sign('https://api.test/x', { secret, expiresIn: -1 });
		const error = await SignedUrl.assert(link, { secret }).catch((e) => e);
		expect(error).toBeInstanceOf(InvalidSignatureError);
		expect(error.detail).toBe('This link has expired.');
		expect(await SignedUrl.verify('https://api.test/x', { secret })).toBe(false);
	});
});
