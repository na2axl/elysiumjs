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

import type { PasswordHasherDriver } from './password';

import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

import { PasswordHasher } from './password';

/**
 * The scrypt parameters: the cost `N` (16384 by default), the block size `r` (8), the
 * parallelism `p` (1) and the key length in bytes (32).
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type ScryptOptions = { N?: number; r?: number; p?: number; keyLength?: number };

const derive = (
	password: string,
	salt: Buffer,
	options: Required<ScryptOptions>
): Promise<Buffer> =>
	new Promise((resolve, reject) =>
		scrypt(
			password,
			salt,
			options.keyLength,
			{ N: options.N, r: options.r, p: options.p, maxmem: 256 * options.N * options.r },
			(error, key) => (error ? reject(error) : resolve(key))
		)
	);

/**
 * Hashes passwords with scrypt from `node:crypto`: Node.js, Bun, and Workers with the
 * `nodejs_compat` flag. Registered as the `scrypt` driver of {@link PasswordHasher}, the default.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
@PasswordHasher.driver('scrypt')
export class ScryptPasswordHasher implements PasswordHasherDriver {
	public readonly prefix = '$scrypt$';
	readonly #options: Required<ScryptOptions>;

	constructor(options: ScryptOptions = {}) {
		this.#options = { N: 16384, r: 8, p: 1, keyLength: 32, ...options };
	}

	public async hash(password: string): Promise<string> {
		const salt = randomBytes(16);
		const key = await derive(password, salt, this.#options);
		const { N, r, p } = this.#options;
		return `${this.prefix}N=${N},r=${r},p=${p}$${salt.toString('base64url')}$${key.toString('base64url')}`;
	}

	public async verify(password: string, hash: string): Promise<boolean> {
		const parsed = this.#parse(hash);
		if (!parsed) return false;
		const key = await derive(password, parsed.salt, {
			...parsed.options,
			keyLength: parsed.key.length
		});
		return key.length === parsed.key.length && timingSafeEqual(key, parsed.key);
	}

	public needsRehash(hash: string): boolean {
		const parsed = this.#parse(hash);
		return !parsed || parsed.options.N < this.#options.N || parsed.options.r < this.#options.r;
	}

	#parse(hash: string) {
		const match = /^\$scrypt\$N=(\d+),r=(\d+),p=(\d+)\$([\w-]+)\$([\w-]+)$/.exec(hash);
		if (!match) return null;
		return {
			options: { N: Number(match[1]), r: Number(match[2]), p: Number(match[3]), keyLength: 32 },
			salt: Buffer.from(match[4]!, 'base64url'),
			key: Buffer.from(match[5]!, 'base64url')
		};
	}
}
