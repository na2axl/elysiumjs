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

import type { CryptoKey, JWTPayload, KeyObject } from 'jose';
import type { Secret } from './secret';

import { Clock, DomainError } from '../index';
import { jwtVerify, SignJWT } from 'jose';

import { utf8 } from './crypto';
import { resolveSecret } from './secret';

/**
 * The key of a token: a shared secret (HS256), or a key of an asymmetric algorithm such as EdDSA
 * or ES256, with its algorithm. A secret can be a function that reads it when the token is signed
 * or verified, such as from a secrets store bound to the request.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type JwtKey =
	{ secret: Secret } | { key: CryptoKey | KeyObject | Uint8Array; algorithm: string };

/**
 * The options of a signed token.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type JwtSignOptions = JwtKey & {
	/** How long the token lives, such as `15m` or `7d`, or a number of seconds. */
	expiresIn?: string | number;
	issuer?: string;
	audience?: string | string[];
	/** The subject, usually the user id. */
	subject?: string;
	/**
	 * When the token is issued, which `expiresIn` counts from. Defaults to `Clock.now()`. With it, or
	 * with a frozen or moved clock, a string `expiresIn` takes the units s, m, h, d and w, such as
	 * `15m`.
	 */
	issuedAt?: Date;
};

/**
 * What a token must carry to verify.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type JwtVerifyOptions = (JwtKey | { keys: readonly JwtKey[] }) & {
	issuer?: string | string[];
	audience?: string | string[];
	/** The clock skew allowed, in seconds. Defaults to 5. */
	clockTolerance?: number;
	/**
	 * The claims a token must carry. Defaults to `['exp']`, so that a token without an expiry,
	 * which would never expire, is refused; pass `[]` to accept one.
	 */
	requiredClaims?: readonly string[];
	/** The time the token's expiry and not-before are checked against. Defaults to `Clock.now()`. */
	currentDate?: Date;
};

/**
 * Raised when a token does not verify: a bad signature, an expired token, or a wrong issuer or
 * audience. Rendered as a 401 problem.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class InvalidTokenError extends DomainError.for('UNAUTHENTICATED', 401) {
	constructor(reason: string) {
		super(`The token is invalid: ${reason}.`);
	}
}

const keyOf = async (key: JwtKey) => {
	if (!('secret' in key)) return { key: key.key, algorithm: key.algorithm };
	return { key: utf8(await resolveSecret(key.secret, 'JWT secret')), algorithm: 'HS256' };
};

const UNIT_SECONDS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86_400, w: 604_800 };

/** The seconds of a lifetime such as `15m`, `12h` or `7d`. */
const secondsOf = (lifetime: string): number => {
	const match = /^(\d+)\s*([smhdw])$/.exec(lifetime.trim());
	if (!match)
		throw new TypeError(
			`Invalid token lifetime "${lifetime}": use a number of seconds or a value such as 15m, 12h or 7d.`
		);
	return Number(match[1]) * UNIT_SECONDS[match[2]];
};

const keysOf = (options: JwtVerifyOptions): readonly JwtKey[] =>
	'keys' in options ? options.keys : [options];

/**
 * Whether a verification failure could pass with another key: a bad signature, or an algorithm
 * this key does not use. An expired token or a wrong claim fails with every key.
 */
const otherKeyMayVerify = (error: unknown): boolean => {
	const code = (error as { code?: string }).code;
	return code === 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED' || code === 'ERR_JOSE_ALG_NOT_ALLOWED';
};

const reasonOf = (error: unknown): string => {
	const code = (error as { code?: string }).code;
	return code === 'ERR_JWT_EXPIRED'
		? 'it has expired'
		: code === 'ERR_JWT_CLAIM_VALIDATION_FAILED'
			? (error as Error).message
			: 'it does not verify';
};

export namespace Jwt {
	/**
	 * Signs a JSON Web Token with jose, which runs on WebCrypto, so on every runtime.
	 * @author Axel Nana <ax.lnana@outlook.com>
	 * @param claims The claims of the token.
	 * @param options The key, the lifetime and the registered claims.
	 * @example
	 * ```ts
	 * const token = await Jwt.sign({ role: 'admin' }, { secret: env.JWT_SECRET, subject: user.id, expiresIn: '15m' });
	 * ```
	 */
	export const sign = async (claims: JWTPayload, options: JwtSignOptions): Promise<string> => {
		const { key, algorithm } = await keyOf(options);
		const issuedAt = Math.floor((options.issuedAt?.getTime() ?? Clock.epochMs()) / 1000);
		let jwt = new SignJWT(claims)
			.setProtectedHeader({ alg: algorithm, typ: 'JWT' })
			.setIssuedAt(issuedAt);
		if (options.expiresIn !== undefined) {
			const { expiresIn } = options;
			// jose counts a string lifetime from the machine's time; from another issue time, or with a
			// frozen or moved clock, it is converted here.
			jwt = jwt.setExpirationTime(
				typeof expiresIn === 'number'
					? issuedAt + expiresIn
					: options.issuedAt || Clock.isAdjusted()
						? issuedAt + secondsOf(expiresIn)
						: expiresIn
			);
		}
		if (options.issuer) jwt = jwt.setIssuer(options.issuer);
		if (options.audience) jwt = jwt.setAudience(options.audience);
		if (options.subject) jwt = jwt.setSubject(options.subject);
		return jwt.sign(key);
	};

	/**
	 * Verifies a token and returns its claims. With `keys`, each key is tried in order until one
	 * verifies the signature, so that tokens signed with the previous key still verify during a
	 * rotation.
	 * @author Axel Nana <ax.lnana@outlook.com>
	 * @param token The token.
	 * @param options The key or keys, and the claims the token must carry.
	 * @example
	 * ```ts
	 * const claims = await Jwt.verify(token, {
	 * 	keys: [{ secret: () => secrets.get('jwt-current') }, { secret: () => secrets.get('jwt-previous') }],
	 * 	issuer: 'api',
	 * 	requiredClaims: ['exp', 'sub']
	 * });
	 * ```
	 * @throws {InvalidTokenError} When the token does not verify (401).
	 */
	export const verify = async <T extends JWTPayload = JWTPayload>(
		token: string,
		options: JwtVerifyOptions
	): Promise<T> => {
		const keys = keysOf(options);
		if (keys.length === 0) throw new InvalidTokenError('no key verifies it');
		let failure: unknown;
		for (const candidate of keys) {
			const { key, algorithm } = await keyOf(candidate);
			try {
				const { payload } = await jwtVerify(token, key, {
					algorithms: [algorithm],
					issuer: options.issuer,
					audience: options.audience,
					clockTolerance: options.clockTolerance ?? 5,
					requiredClaims: [...(options.requiredClaims ?? ['exp'])],
					currentDate: options.currentDate ?? Clock.now()
				});
				return payload as T;
			} catch (error) {
				failure = error;
				if (!otherKeyMayVerify(error)) break;
			}
		}
		throw new InvalidTokenError(reasonOf(failure));
	};
}
