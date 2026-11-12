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

import type { PortDriverName } from '../port';
import type { Pbkdf2PasswordHasher } from './pbkdf2';
import type { ScryptPasswordHasher } from './scrypt';

import { Port } from '../port';

/**
 * Hashes and verifies passwords: a driver of the {@link PasswordHasher} port. A hash is a
 * self-describing string (`$scrypt$...`, `$pbkdf2-sha256$...`, `$argon2id$...`), so that a driver
 * recognises its own hashes.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export interface PasswordHasherDriver {
	/** The prefix of the hashes this driver makes, such as `$scrypt$`. */
	readonly prefix: string;
	hash(password: string): Promise<string>;
	verify(password: string, hash: string): Promise<boolean>;
	/** Whether a hash of this driver was made with weaker parameters than the current ones. */
	needsRehash(hash: string): boolean;
}

declare module '../port' {
	interface Ports {
		'password-hasher': PasswordHasherDriver;
	}

	interface PortDrivers {
		'password-hasher:scrypt': typeof ScryptPasswordHasher;
		'password-hasher:pbkdf2': typeof Pbkdf2PasswordHasher;
	}
}

/**
 * The password hashing port. Harpocrates registers the `scrypt` driver (the default) and the
 * `pbkdf2` driver; `@elysiumjs/bun` adds `bun` (Argon2id through `Bun.password`), and an app can
 * register its own with `@PasswordHasher.driver(name)`. {@link Password} hashes and verifies
 * with them.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @example
 * ```ts
 * Password.use(PasswordHasher.for('scrypt', { N: 32768 }));
 * ```
 */
export class PasswordHasher extends Port('password-hasher') {}

let configured: PasswordHasherDriver | undefined;
const known: PasswordHasherDriver[] = [];
const byName = new Map<string, PasswordHasherDriver>();

/** The default driver: scrypt, which runs on Node.js, Bun and Workers with `nodejs_compat`. */
const current = (): PasswordHasherDriver => (configured ??= PasswordHasher.for('scrypt'));

/** A driver with its default options, built once, to recognise the hashes of its prefix. */
const driverNamed = (name: string): PasswordHasherDriver | undefined => {
	if (!byName.has(name)) {
		try {
			byName.set(name, PasswordHasher.for(name as PortDriverName<'password-hasher'>));
		} catch {
			return undefined;
		}
	}
	return byName.get(name);
};

/**
 * Hashes and verifies passwords with the {@link PasswordHasher} drivers. New hashes come from
 * the current driver (scrypt unless {@link Password.use} sets another); `verify` recognises the
 * hashes of every registered driver by their prefix, and `needsRehash` tells when to replace one.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export namespace Password {
	/**
	 * Sets the driver that makes new hashes. Hashes of the other drivers still verify, and
	 * `needsRehash()` tells when to replace them.
	 * @author Axel Nana <ax.lnana@outlook.com>
	 * @param hasher The driver, or the name of a registered one, built with its default options.
	 */
	export const use = (hasher: PasswordHasherDriver | PortDriverName<'password-hasher'>): void => {
		const driver = typeof hasher === 'string' ? PasswordHasher.for(hasher) : hasher;
		configured = driver;
		register(driver);
	};

	/**
	 * Adds a driver instance that `verify()` recognises by its prefix, such as one with the
	 * parameters of older hashes. Registered drivers are recognised without it.
	 * @author Axel Nana <ax.lnana@outlook.com>
	 */
	export const register = (hasher: PasswordHasherDriver): void => {
		const index = known.findIndex((entry) => entry.prefix === hasher.prefix);
		if (index >= 0) known[index] = hasher;
		else known.push(hasher);
	};

	/** The driver that makes new hashes. */
	export const hasher = (): PasswordHasherDriver => current();

	/**
	 * Hashes a password with the current driver.
	 * @author Axel Nana <ax.lnana@outlook.com>
	 */
	export const hash = (password: string): Promise<string> => current().hash(password);

	const hasherOf = (hash: string): PasswordHasherDriver | undefined => {
		const driver = current();
		if (hash.startsWith(driver.prefix)) return driver;
		const found = known.find((entry) => hash.startsWith(entry.prefix));
		if (found) return found;
		for (const name of PasswordHasher.drivers()) {
			const candidate = driverNamed(name);
			if (candidate && hash.startsWith(candidate.prefix)) return candidate;
		}
		return undefined;
	};

	/**
	 * Verifies a password against a hash of any known driver. An unknown or malformed hash does
	 * not verify.
	 * @author Axel Nana <ax.lnana@outlook.com>
	 */
	export const verify = async (password: string, hash: string): Promise<boolean> => {
		const driver = hasherOf(hash);
		if (!driver) return false;
		try {
			return await driver.verify(password, hash);
		} catch {
			return false;
		}
	};

	/**
	 * Whether a hash should be replaced by a new one, after a successful login: it comes from
	 * another driver, or from weaker parameters.
	 * @author Axel Nana <ax.lnana@outlook.com>
	 */
	export const needsRehash = (hash: string): boolean => {
		const driver = current();
		return !hash.startsWith(driver.prefix) || driver.needsRehash(hash);
	};

	/** Forgets the configured and registered drivers. */
	export const reset = (): void => {
		configured = undefined;
		known.length = 0;
		byName.clear();
	};
}
