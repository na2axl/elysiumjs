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

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** The bytes of a string, as UTF-8. */
export const utf8 = (value: string): Uint8Array<ArrayBuffer> => encoder.encode(value);

/** The string of UTF-8 bytes. */
export const fromUtf8 = (bytes: Uint8Array): string => decoder.decode(bytes);

/** Random bytes from the platform's cryptographic generator. */
export const randomBytes = (length: number): Uint8Array<ArrayBuffer> =>
	crypto.getRandomValues(new Uint8Array(length));

/** Bytes as base64url, without padding. */
export const toBase64Url = (bytes: Uint8Array): string => {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

/** The bytes of a base64url (or base64) string. */
export const fromBase64Url = (value: string): Uint8Array<ArrayBuffer> => {
	const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
	const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
	return Uint8Array.from(binary, (char) => char.charCodeAt(0));
};

/** Bytes as lower-case hex. */
export const toHex = (bytes: Uint8Array): string =>
	[...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');

/** A random token: `bytes` random bytes as base64url. */
export const randomToken = (bytes = 32): string => toBase64Url(randomBytes(bytes));

/**
 * Compares two strings in a time that does not depend on where they differ. Their lengths are not
 * secret.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export const safeEqual = (a: string, b: string): boolean => {
	const left = utf8(a);
	const right = utf8(b);
	if (left.length !== right.length) return false;
	let diff = 0;
	for (let i = 0; i < left.length; i++) diff |= left[i]! ^ right[i]!;
	return diff === 0;
};

/** The hex SHA-256 of a string. */
export const sha256 = async (value: string): Promise<string> =>
	toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', utf8(value))));

const hmacKeys = new Map<string, Promise<CryptoKey>>();

const hmacKey = (secret: string, hash = 'SHA-256'): Promise<CryptoKey> => {
	const id = `${hash}\u0000${secret}`;
	let key = hmacKeys.get(id);
	if (!key) {
		key = crypto.subtle.importKey('raw', utf8(secret), { name: 'HMAC', hash }, false, [
			'sign',
			'verify'
		]);
		hmacKeys.set(id, key);
	}
	return key;
};

/** The base64url HMAC-SHA256 of a value. */
export const hmac = async (secret: string, value: string): Promise<string> =>
	toBase64Url(new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret), utf8(value))));

/** Whether a base64url signature is the HMAC-SHA256 of a value. */
export const verifyHmac = async (
	secret: string,
	value: string,
	signature: string
): Promise<boolean> => {
	try {
		return await crypto.subtle.verify(
			'HMAC',
			await hmacKey(secret),
			fromBase64Url(signature),
			utf8(value)
		);
	} catch {
		return false;
	}
};

const aesKeys = new Map<string, Promise<CryptoKey>>();

/** An AES-GCM key derived from a secret with HKDF, one per purpose. */
const aesKey = (secret: string, purpose: string): Promise<CryptoKey> => {
	const id = `${purpose}\u0000${secret}`;
	let key = aesKeys.get(id);
	if (!key) {
		key = crypto.subtle.importKey('raw', utf8(secret), 'HKDF', false, ['deriveKey']).then((base) =>
			crypto.subtle.deriveKey(
				{
					name: 'HKDF',
					hash: 'SHA-256',
					salt: new Uint8Array(),
					info: utf8(`elysium:${purpose}`)
				},
				base,
				{ name: 'AES-GCM', length: 256 },
				false,
				['encrypt', 'decrypt']
			)
		);
		aesKeys.set(id, key);
	}
	return key;
};

/**
 * Encrypts and authenticates a string with AES-256-GCM, under a key derived from a secret for a
 * purpose. The result is base64url: the 12-byte IV, then the ciphertext and its tag.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export const encrypt = async (
	secret: string,
	purpose: string,
	plaintext: string
): Promise<string> => {
	const iv = randomBytes(12);
	const sealed = new Uint8Array(
		await crypto.subtle.encrypt(
			{ name: 'AES-GCM', iv },
			await aesKey(secret, purpose),
			utf8(plaintext)
		)
	);
	const out = new Uint8Array(iv.length + sealed.length);
	out.set(iv);
	out.set(sealed, iv.length);
	return toBase64Url(out);
};

/**
 * Decrypts a value of {@link encrypt}, or answers `null` when it was tampered with or sealed under
 * another secret.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export const decrypt = async (
	secret: string,
	purpose: string,
	sealed: string
): Promise<string | null> => {
	try {
		const bytes = fromBase64Url(sealed);
		const plain = await crypto.subtle.decrypt(
			{ name: 'AES-GCM', iv: bytes.slice(0, 12) },
			await aesKey(secret, purpose),
			bytes.slice(12)
		);
		return fromUtf8(new Uint8Array(plain));
	} catch {
		return null;
	}
};
