// Copyright (c) 2025-present Axel Nana <ax.lnana@outlook.com>. All rights reserved.
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

import type { PasswordHasherDriver } from '@elysiumjs/olympus/harpocrates';

import { PasswordHasher } from '@elysiumjs/olympus/harpocrates';

declare module '@elysiumjs/olympus' {
	interface PortDrivers {
		'password-hasher:bun': typeof BunPasswordHasher;
	}
}

/**
 * Options of {@link BunPasswordHasher}: the Argon2id memory cost in KiB (65536 by default) and
 * time cost (2 by default).
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type BunPasswordHasherOptions = { memoryCost?: number; timeCost?: number };

/**
 * Hashes passwords with Argon2id through `Bun.password`. Registered as the `bun` driver of the
 * `PasswordHasher` port when `@elysiumjs/bun` is imported.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @example
 * ```ts
 * import '@elysiumjs/bun';
 * import { Password } from '@elysiumjs/olympus/harpocrates';
 *
 * Password.use('bun');
 * ```
 */
@PasswordHasher.driver('bun')
export class BunPasswordHasher implements PasswordHasherDriver {
	public readonly prefix = '$argon2id$';

	constructor(private readonly options: BunPasswordHasherOptions = {}) {}

	public hash(password: string): Promise<string> {
		return Bun.password.hash(password, { algorithm: 'argon2id', ...this.options });
	}

	public async verify(password: string, hash: string): Promise<boolean> {
		try {
			return await Bun.password.verify(password, hash);
		} catch {
			return false;
		}
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
