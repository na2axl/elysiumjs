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

import type { Secret } from './secret';

import { ElysiumError } from '../index';
import { Port } from '../port';
import { fromBase64Url, fromUtf8, randomBytes, toBase64Url, utf8 } from './crypto';
import { assertStrongSecret, resolveSecret } from './secret';

/**
 * Encrypts and decrypts strings: a driver of the {@link Cipher} port. A ciphertext names its
 * algorithm and the id of its key (`<algorithm>:<keyId>:<payload>`), so that keys can rotate:
 * new values use the current key, and older ones still decrypt with theirs.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export interface CipherDriver {
	/** The algorithm named at the start of each ciphertext, such as `aes-256-gcm`. */
	readonly algorithm: string;
	/**
	 * Encrypts and authenticates a string.
	 * @param plaintext The value.
	 * @param context What the value is bound to, such as a column or a job name: decrypting
	 * needs the same context, so a ciphertext cannot be moved elsewhere.
	 */
	encrypt(plaintext: string, context?: string): Promise<string>;
	/**
	 * Decrypts a value of {@link CipherDriver.encrypt}.
	 * @throws {DecryptionFailedError} When the value was tampered with, has another context, or
	 * names a key or an algorithm the driver does not have.
	 */
	decrypt(ciphertext: string, context?: string): Promise<string>;
}

declare module '../port' {
	interface Ports {
		cipher: CipherDriver;
	}

	interface PortDrivers {
		'cipher:aes-gcm': typeof AesGcmCipher;
	}
}

/**
 * The encryption port. Harpocrates registers the `aes-gcm` driver; an app can register its own
 * with `@Cipher.driver(name)`, such as one over a key management service.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @example
 * ```ts
 * const cipher = Cipher.for('aes-gcm', {
 * 	keys: { '2026-11': () => Env.get('CIPHER_KEY') as string },
 * 	current: '2026-11'
 * });
 * const sealed = await cipher.encrypt('4111 1111 1111 1111', 'cards.number');
 * ```
 */
export class Cipher extends Port('cipher') {}

/**
 * Raised when a ciphertext does not decrypt: it was tampered with, was sealed for another
 * context, or names a key or an algorithm the cipher does not have.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class DecryptionFailedError extends ElysiumError {
	constructor(reason: string) {
		super(`The value could not be decrypted: ${reason}.`);
	}
}

/**
 * Options of {@link AesGcmCipher}.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type AesGcmCipherOptions = {
	/**
	 * The keyring: each key by its id. A key is a secret of at least 32 bytes, or a function that
	 * reads it; the AES key is derived from it with HKDF-SHA-256. Ids may not contain `:`.
	 */
	keys: Record<string, Secret>;
	/** The id of the key new values use. Defaults to the only key of the keyring. */
	current?: string;
};

const ALGORITHM = 'aes-256-gcm';

/**
 * Encrypts with AES-256-GCM through Web Crypto, which every runtime has, over a keyring of
 * secrets. Each value gets a random 96-bit IV, and the context is authenticated as additional
 * data. Registered as the `aes-gcm` driver of {@link Cipher}.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
@Cipher.driver('aes-gcm')
export class AesGcmCipher implements CipherDriver {
	public readonly algorithm = ALGORITHM;
	readonly #keys: Record<string, Secret>;
	readonly #current: string;
	readonly #derived = new Map<string, { secret: string; key: Promise<CryptoKey> }>();

	constructor(options: AesGcmCipherOptions) {
		const ids = Object.keys(options?.keys ?? {});
		if (ids.length === 0) throw new ElysiumError('AesGcmCipher needs at least one key.');
		const invalid = ids.find((id) => id.length === 0 || id.includes(':'));
		if (invalid !== undefined) {
			throw new ElysiumError(`The key id "${invalid}" is empty or contains ":".`);
		}
		const current = options.current ?? (ids.length === 1 ? ids[0]! : undefined);
		if (current === undefined) {
			throw new ElysiumError('AesGcmCipher has several keys: name the current one.');
		}
		if (!Object.hasOwn(options.keys, current)) {
			throw new ElysiumError(`The current key "${current}" is not in the keyring.`);
		}
		this.#keys = options.keys;
		this.#current = current;
	}

	public async encrypt(plaintext: string, context = ''): Promise<string> {
		const iv = randomBytes(12);
		const sealed = await crypto.subtle.encrypt(
			{ name: 'AES-GCM', iv, additionalData: utf8(context) },
			await this.#key(this.#current),
			utf8(plaintext)
		);
		const out = new Uint8Array(iv.length + sealed.byteLength);
		out.set(iv);
		out.set(new Uint8Array(sealed), iv.length);
		return `${ALGORITHM}:${this.#current}:${toBase64Url(out)}`;
	}

	public async decrypt(ciphertext: string, context = ''): Promise<string> {
		const [algorithm, id, payload, ...rest] = ciphertext.split(':');
		if (algorithm !== ALGORITHM || id === undefined || payload === undefined || rest.length > 0) {
			throw new DecryptionFailedError(`it is not an ${ALGORITHM} value`);
		}
		if (!Object.hasOwn(this.#keys, id))
			throw new DecryptionFailedError(`no key "${id}" is in the keyring`);
		const key = await this.#key(id);
		try {
			const bytes = fromBase64Url(payload);
			const plain = await crypto.subtle.decrypt(
				{ name: 'AES-GCM', iv: bytes.slice(0, 12), additionalData: utf8(context) },
				key,
				bytes.slice(12)
			);
			return fromUtf8(new Uint8Array(plain));
		} catch {
			throw new DecryptionFailedError('it was altered, or sealed for another context');
		}
	}

	/** The AES key of a keyring entry, derived again when its secret changes. */
	async #key(id: string): Promise<CryptoKey> {
		const secret = await resolveSecret(this.#keys[id]!, `cipher key "${id}"`);
		assertStrongSecret(secret, `cipher key "${id}"`);
		const cached = this.#derived.get(id);
		if (cached?.secret === secret) return cached.key;
		const key = crypto.subtle
			.importKey('raw', utf8(secret), 'HKDF', false, ['deriveKey'])
			.then((base) =>
				crypto.subtle.deriveKey(
					{ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(), info: utf8('elysium:cipher') },
					base,
					{ name: 'AES-GCM', length: 256 },
					false,
					['encrypt', 'decrypt']
				)
			);
		this.#derived.set(id, { secret, key });
		return key;
	}
}
