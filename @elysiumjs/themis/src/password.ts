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

import { ElysiumError } from '@elysiumjs/core';

import { fromBase64Url, randomBytes, safeEqual, toBase64Url, utf8 } from './crypto';

/**
 * Hashes and verifies passwords. A hash is a self-describing string (`$argon2id$...`,
 * `$pbkdf2-sha256$...`, `$scrypt$...`), so that a hasher recognises its own hashes.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export interface PasswordHasher {
	/** The prefix of the hashes this hasher makes, such as `$pbkdf2-sha256$`. */
	readonly prefix: string;
	hash(password: string): Promise<string>;
	verify(password: string, hash: string): Promise<boolean>;
	/** Whether a hash of this hasher was made with weaker parameters than the current ones. */
	needsRehash(hash: string): boolean;
}

/** Workers cap PBKDF2 at 100,000 iterations. */
const onWorkers = (): boolean => globalThis.navigator?.userAgent === 'Cloudflare-Workers';

/**
 * Hashes passwords with PBKDF2-HMAC-SHA256 through WebCrypto, which every runtime has. The
 * iterations default to 600,000, and to 100,000 on Cloudflare Workers, which cap PBKDF2 there.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class Pbkdf2PasswordHasher implements PasswordHasher {
	public readonly prefix = '$pbkdf2-sha256$';

	constructor(private readonly options: { iterations?: number } = {}) {}

	private get iterations(): number {
		return this.options.iterations ?? (onWorkers() ? 100_000 : 600_000);
	}

	public async hash(password: string): Promise<string> {
		const salt = randomBytes(16);
		const key = await this.derive(password, salt, this.iterations);
		return `${this.prefix}i=${this.iterations}$${toBase64Url(salt)}$${toBase64Url(key)}`;
	}

	public async verify(password: string, hash: string): Promise<boolean> {
		const parsed = this.parse(hash);
		if (!parsed) return false;
		const key = await this.derive(password, parsed.salt, parsed.iterations);
		return safeEqual(toBase64Url(key), parsed.key);
	}

	public needsRehash(hash: string): boolean {
		const parsed = this.parse(hash);
		return !parsed || parsed.iterations < this.iterations;
	}

	private parse(
		hash: string
	): { iterations: number; salt: Uint8Array<ArrayBuffer>; key: string } | null {
		const match = /^\$pbkdf2-sha256\$i=(\d+)\$([\w-]+)\$([\w-]+)$/.exec(hash);
		if (!match) return null;
		return { iterations: Number(match[1]), salt: fromBase64Url(match[2]!), key: match[3]! };
	}

	private async derive(
		password: string,
		salt: Uint8Array<ArrayBuffer>,
		iterations: number
	): Promise<Uint8Array> {
		const base = await crypto.subtle.importKey('raw', utf8(password), 'PBKDF2', false, [
			'deriveBits'
		]);
		const bits = await crypto.subtle.deriveBits(
			{ name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
			base,
			256
		);
		return new Uint8Array(bits);
	}
}

type BunPassword = {
	hash(
		password: string,
		options: { algorithm: 'argon2id'; memoryCost?: number; timeCost?: number }
	): Promise<string>;
	verify(password: string, hash: string): Promise<boolean>;
};

/** The `Bun.password` API, when the app runs on Bun. */
const bunPassword = (): BunPassword | undefined =>
	// portability-allow: feature detection, only BunPasswordHasher uses it
	(globalThis as { Bun?: { password?: BunPassword } }).Bun?.password;

/**
 * Hashes passwords with Argon2id through `Bun.password`. Only available on Bun.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class BunPasswordHasher implements PasswordHasher {
	public readonly prefix = '$argon2id$';

	constructor(private readonly options: { memoryCost?: number; timeCost?: number } = {}) {}

	private get api(): BunPassword {
		const api = bunPassword();
		if (!api) {
			throw new ElysiumError(
				'BunPasswordHasher needs the Bun runtime. Use Pbkdf2PasswordHasher, or ScryptPasswordHasher from @elysiumjs/themis/scrypt.'
			);
		}
		return api;
	}

	public hash(password: string): Promise<string> {
		return this.api.hash(password, { algorithm: 'argon2id', ...this.options });
	}

	public verify(password: string, hash: string): Promise<boolean> {
		return this.api.verify(password, hash).catch(() => false);
	}

	public needsRehash(hash: string): boolean {
		const match = /^\$argon2id\$v=\d+\$m=(\d+),t=(\d+)/.exec(hash);
		if (!match) return true;
		return (
			Number(match[1]) < (this.options.memoryCost ?? 65536) ||
			Number(match[2]) < (this.options.timeCost ?? 2)
		);
	}
}

let configured: PasswordHasher | undefined;
const known: PasswordHasher[] = [];

/** The default hasher: Argon2id on Bun, PBKDF2 elsewhere (600,000 iterations, 100,000 on Workers). */
const defaultHasher = (): PasswordHasher =>
	(configured ??= bunPassword() ? new BunPasswordHasher() : new Pbkdf2PasswordHasher());

export namespace Password {
	/**
	 * Sets the hasher that makes new hashes. Hashes of the other known hashers still verify, and
	 * `needsRehash()` tells when to replace them.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param hasher The hasher.
	 */
	export const use = (hasher: PasswordHasher): void => {
		configured = hasher;
		register(hasher);
	};

	/**
	 * Adds a hasher that `verify()` recognises by its prefix, such as the one of older hashes.
	 * @author Axel Nana <axel.nana@workbud.com>
	 */
	export const register = (hasher: PasswordHasher): void => {
		const index = known.findIndex((entry) => entry.prefix === hasher.prefix);
		if (index >= 0) known[index] = hasher;
		else known.push(hasher);
	};

	/** The hasher that makes new hashes. */
	export const hasher = (): PasswordHasher => defaultHasher();

	/**
	 * Hashes a password with the current hasher.
	 * @author Axel Nana <axel.nana@workbud.com>
	 */
	export const hash = (password: string): Promise<string> => defaultHasher().hash(password);

	const hasherOf = (hash: string): PasswordHasher | undefined => {
		const current = defaultHasher();
		if (hash.startsWith(current.prefix)) return current;
		const found = known.find((entry) => hash.startsWith(entry.prefix));
		if (found) return found;
		if (hash.startsWith('$pbkdf2-sha256$')) return new Pbkdf2PasswordHasher();
		if (hash.startsWith('$argon2') && bunPassword()) return new BunPasswordHasher();
		return undefined;
	};

	/**
	 * Verifies a password against a hash of any known hasher. An unknown or malformed hash does
	 * not verify.
	 * @author Axel Nana <axel.nana@workbud.com>
	 */
	export const verify = async (password: string, hash: string): Promise<boolean> =>
		(await hasherOf(hash)?.verify(password, hash)) ?? false;

	/**
	 * Whether a hash should be replaced by a new one, after a successful login: it comes from
	 * another hasher, or from weaker parameters.
	 * @author Axel Nana <axel.nana@workbud.com>
	 */
	export const needsRehash = (hash: string): boolean => {
		const current = defaultHasher();
		return !hash.startsWith(current.prefix) || current.needsRehash(hash);
	};

	/** Forgets the configured and registered hashers. */
	export const reset = (): void => {
		configured = undefined;
		known.length = 0;
	};
}
