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

import { fromBase64Url, randomBytes, safeEqual, toBase64Url, utf8 } from './crypto';
import { PasswordHasher } from './password';

/** Workers cap PBKDF2 at 100,000 iterations. */
const onWorkers = (): boolean => globalThis.navigator?.userAgent === 'Cloudflare-Workers';

/**
 * Hashes passwords with PBKDF2-HMAC-SHA256 through WebCrypto, which every runtime has. The
 * iterations default to 600,000, and to 100,000 on Cloudflare Workers, which cap PBKDF2 there.
 * Registered as the `pbkdf2` driver of {@link PasswordHasher}.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
@PasswordHasher.driver('pbkdf2')
export class Pbkdf2PasswordHasher implements PasswordHasherDriver {
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
