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

import { describe, expect, it } from 'bun:test';

import {
	AesGcmCipher,
	Cipher,
	DecryptionFailedError,
	WeakSecretError
} from '../../src/harpocrates';

const OLD = 'o'.repeat(32);
const NEW = 'n'.repeat(32);

describe('AesGcmCipher', () => {
	it('is the aes-gcm driver of the Cipher port', () => {
		expect(Cipher.drivers()).toContain('aes-gcm');
		expect(Cipher.for('aes-gcm', { keys: { k: OLD } })).toBeInstanceOf(AesGcmCipher);
	});

	it('round-trips a value, and names its algorithm and key', async () => {
		const cipher = new AesGcmCipher({ keys: { k1: OLD } });
		const sealed = await cipher.encrypt('secret value', 'users.email');
		expect(sealed).toMatch(/^aes-256-gcm:k1:[\w-]+$/);
		expect(await cipher.decrypt(sealed, 'users.email')).toBe('secret value');
		expect(await cipher.encrypt('secret value', 'users.email')).not.toBe(sealed);
	});

	it('refuses another context, an altered value, and foreign values', async () => {
		const cipher = new AesGcmCipher({ keys: { k1: OLD } });
		const sealed = await cipher.encrypt('value', 'a');
		expect(cipher.decrypt(sealed, 'b')).rejects.toBeInstanceOf(DecryptionFailedError);
		expect(cipher.decrypt(sealed)).rejects.toBeInstanceOf(DecryptionFailedError);
		const altered = `${sealed.slice(0, -2)}${sealed.endsWith('AA') ? 'BB' : 'AA'}`;
		expect(cipher.decrypt(altered, 'a')).rejects.toBeInstanceOf(DecryptionFailedError);
		expect(cipher.decrypt('plain', 'a')).rejects.toBeInstanceOf(DecryptionFailedError);
		expect(cipher.decrypt('aes-256-gcm:k2:AAAA', 'a')).rejects.toBeInstanceOf(
			DecryptionFailedError
		);
		expect(cipher.decrypt('aes-256-gcm:toString:AAAA', 'a')).rejects.toBeInstanceOf(
			DecryptionFailedError
		);
		expect(cipher.decrypt('aes-256-gcm:k1:AAAA:x', 'a')).rejects.toBeInstanceOf(
			DecryptionFailedError
		);
	});

	it('rotates keys: new values use the current one, older ones still decrypt', async () => {
		const before = new AesGcmCipher({ keys: { old: OLD } });
		const sealed = await before.encrypt('value');
		const after = new AesGcmCipher({ keys: { old: OLD, new: () => NEW }, current: 'new' });
		expect(await after.decrypt(sealed)).toBe('value');
		expect(await after.encrypt('value')).toStartWith('aes-256-gcm:new:');
		expect(new AesGcmCipher({ keys: { old: NEW } }).decrypt(sealed)).rejects.toBeInstanceOf(
			DecryptionFailedError
		);
	});

	it('validates its keyring', async () => {
		expect(() => new AesGcmCipher({ keys: {} })).toThrow('at least one key');
		expect(() => new AesGcmCipher({ keys: { 'a:b': OLD } })).toThrow('contains ":"');
		expect(() => new AesGcmCipher({ keys: { a: OLD, b: NEW } })).toThrow('name the current');
		expect(() => new AesGcmCipher({ keys: { a: OLD }, current: 'toString' })).toThrow(
			'not in the keyring'
		);
		expect(new AesGcmCipher({ keys: { a: 'short' } }).encrypt('x')).rejects.toBeInstanceOf(
			WeakSecretError
		);
	});
});
