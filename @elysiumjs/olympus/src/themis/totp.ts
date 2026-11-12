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

import { Clock } from '../index';

import { hmac, randomBytes, safeEqual, sha256 } from './crypto';
import { resolveSecret } from './secret';

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

const toBase32 = (bytes: Uint8Array): string => {
	let bits = 0;
	let value = 0;
	let out = '';
	for (const byte of bytes) {
		value = (value << 8) | byte;
		bits += 8;
		while (bits >= 5) {
			out += BASE32[(value >>> (bits - 5)) & 31];
			bits -= 5;
		}
	}
	if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
	return out;
};

const fromBase32 = (text: string): Uint8Array<ArrayBuffer> => {
	const clean = text.toUpperCase().replace(/[\s=-]/g, '');
	let bits = 0;
	let value = 0;
	const out: number[] = [];
	for (const char of clean) {
		const index = BASE32.indexOf(char);
		if (index < 0) throw new TypeError('The TOTP secret is not base32.');
		value = (value << 5) | index;
		bits += 5;
		if (bits >= 8) {
			out.push((value >>> (bits - 8)) & 255);
			bits -= 8;
		}
	}
	return new Uint8Array(out);
};

/**
 * The parameters of TOTP codes. The defaults (6 digits, 30 seconds, SHA-1) are the ones every
 * authenticator app supports.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type TotpOptions = {
	digits?: number;
	period?: number;
	algorithm?: 'SHA1' | 'SHA256' | 'SHA512';
};

const hotp = async (
	secret: string,
	counter: number,
	options: Required<TotpOptions>
): Promise<string> => {
	const message = new Uint8Array(8);
	let rest = counter;
	for (let i = 7; i >= 0; i--) {
		message[i] = rest & 255;
		rest = Math.floor(rest / 256);
	}
	const hash = options.algorithm.replace('SHA', 'SHA-');
	const key = await crypto.subtle.importKey(
		'raw',
		fromBase32(secret),
		{ name: 'HMAC', hash },
		false,
		['sign']
	);
	const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, message));
	const offset = mac[mac.length - 1]! & 15;
	const binary =
		((mac[offset]! & 127) << 24) |
		(mac[offset + 1]! << 16) |
		(mac[offset + 2]! << 8) |
		mac[offset + 3]!;
	return String(binary % 10 ** options.digits).padStart(options.digits, '0');
};

const defaults = (options: TotpOptions = {}): Required<TotpOptions> => ({
	digits: options.digits ?? 6,
	period: options.period ?? 30,
	algorithm: options.algorithm ?? 'SHA1'
});

export namespace Totp {
	/**
	 * Generates a TOTP secret: 20 random bytes as base32, as authenticator apps expect.
	 * @author Axel Nana <ax.lnana@outlook.com>
	 */
	export const generateSecret = (bytes = 20): string => toBase32(randomBytes(bytes));

	/**
	 * The `otpauth://` URI of a secret, to show as a QR code.
	 * @author Axel Nana <ax.lnana@outlook.com>
	 * @param options The secret, the issuer (the app name) and the account (such as the email).
	 */
	export const uri = (
		options: TotpOptions & { secret: string; issuer: string; account: string }
	): string => {
		const { digits, period, algorithm } = defaults(options);
		const label = `${encodeURIComponent(options.issuer)}:${encodeURIComponent(options.account)}`;
		const params = new URLSearchParams({
			secret: options.secret,
			issuer: options.issuer,
			algorithm,
			digits: String(digits),
			period: String(period)
		});
		return `otpauth://totp/${label}?${params.toString()}`;
	};

	/**
	 * The code of a secret at a time (RFC 6238).
	 * @author Axel Nana <ax.lnana@outlook.com>
	 * @param secret The base32 secret.
	 * @param options The parameters, and the time in milliseconds (now by default).
	 */
	export const generate = (
		secret: string,
		options: TotpOptions & { time?: number } = {}
	): Promise<string> => {
		const config = defaults(options);
		return hotp(
			secret,
			Math.floor((options.time ?? Clock.epochMs()) / 1000 / config.period),
			config
		);
	};

	/**
	 * Whether a code is the one of the current period, or of `window` periods around it, to allow
	 * for clock drift. Compare the returned counter with the last one used to refuse a replay.
	 * @author Axel Nana <ax.lnana@outlook.com>
	 * @param code The code the user typed.
	 * @param secret The base32 secret.
	 * @param options The parameters, the window (1 by default) and the time.
	 * @returns The counter of the matching period, or `null`.
	 */
	export const verify = async (
		code: string,
		secret: string,
		options: TotpOptions & { window?: number; time?: number } = {}
	): Promise<number | null> => {
		const config = defaults(options);
		const typed = code.replace(/\s/g, '');
		if (!/^\d+$/.test(typed) || typed.length !== config.digits) return null;
		const current = Math.floor((options.time ?? Clock.epochMs()) / 1000 / config.period);
		const window = options.window ?? 1;
		let found: number | null = null;
		for (let step = -window; step <= window; step++) {
			// Every candidate is computed and compared, so the time does not tell which one matched.
			if (safeEqual(await hotp(secret, current + step, config), typed) && found === null) {
				found = current + step;
			}
		}
		return found;
	};
}

const CODE_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz';

const normalize = (code: string): string => code.toLowerCase().replace(/[\s-]/g, '');

/**
 * The options of {@link BackupCodes.generate} and {@link BackupCodes.consume}.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type BackupCodeOptions = {
	/**
	 * A key the hashes are HMACs with. Without it they are plain SHA-256, which a leaked table
	 * lets anyone test guesses against offline; with it, guesses need the key too.
	 */
	secret?: Secret;
};

const hashCode = async (code: string, options: BackupCodeOptions): Promise<string> =>
	options.secret === undefined
		? sha256(normalize(code))
		: hmac(await resolveSecret(options.secret, 'backup code secret'), normalize(code));

export namespace BackupCodes {
	/**
	 * Generates one-time backup codes, such as `k3m9q-x7t2p`. Show the codes once and store only
	 * their hashes.
	 * @author Axel Nana <ax.lnana@outlook.com>
	 * @param count The number of codes. Defaults to 10.
	 * @param options The key of the hashes, if any.
	 * @returns The codes, and their hashes in the same order.
	 */
	export const generate = async (
		count = 10,
		options: BackupCodeOptions = {}
	): Promise<{ codes: string[]; hashes: string[] }> => {
		const codes = Array.from({ length: count }, () => {
			const chars = [...randomBytes(10)].map((byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]);
			return `${chars.slice(0, 5).join('')}-${chars.slice(5).join('')}`;
		});
		return { codes, hashes: await Promise.all(codes.map((code) => hashCode(code, options))) };
	};

	/**
	 * Uses a backup code: checks it against the stored hashes, and returns the hashes left once it
	 * is used up. Case, spaces and dashes do not matter.
	 * @author Axel Nana <ax.lnana@outlook.com>
	 * @param code The code the user typed.
	 * @param hashes The stored hashes.
	 * @param options The key the hashes were made with, if any.
	 * @returns Whether the code is valid, the hash it matched, and the hashes left.
	 */
	export const consume = async (
		code: string,
		hashes: readonly string[],
		options: BackupCodeOptions = {}
	): Promise<{ valid: boolean; used?: string; remaining: string[] }> => {
		const hash = await hashCode(code, options);
		const index = hashes.findIndex((stored) => safeEqual(stored, hash));
		if (index < 0) return { valid: false, remaining: [...hashes] };
		return { valid: true, used: hashes[index], remaining: hashes.filter((_, i) => i !== index) };
	};
}
