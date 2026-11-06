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

import type { CryptoKey, JWTPayload, KeyObject } from 'jose';

import { DomainError } from '@elysiumjs/core';
import { jwtVerify, SignJWT } from 'jose';

import { utf8 } from './crypto';

/**
 * The key of a token: a shared secret (HS256), or a key of an asymmetric algorithm such as EdDSA
 * or ES256, with its algorithm.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type JwtKey =
	{ secret: string } | { key: CryptoKey | KeyObject | Uint8Array; algorithm: string };

/**
 * The options of a signed token.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type JwtSignOptions = JwtKey & {
	/** How long the token lives, such as `15m` or `7d`, or a number of seconds. */
	expiresIn?: string | number;
	issuer?: string;
	audience?: string | string[];
	/** The subject, usually the user id. */
	subject?: string;
};

/**
 * What a token must carry to verify.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type JwtVerifyOptions = JwtKey & {
	issuer?: string | string[];
	audience?: string | string[];
	/** The clock skew allowed, in seconds. Defaults to 5. */
	clockTolerance?: number;
};

/**
 * Raised when a token does not verify: a bad signature, an expired token, or a wrong issuer or
 * audience. Rendered as a 401 problem.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class InvalidTokenError extends DomainError {
	constructor(reason: string) {
		super({ status: 401, detail: `The token is invalid: ${reason}.` });
	}
}

const keyOf = (key: JwtKey) =>
	'secret' in key
		? { key: utf8(key.secret), algorithm: 'HS256' }
		: { key: key.key, algorithm: key.algorithm };

export namespace Jwt {
	/**
	 * Signs a JSON Web Token with jose, which runs on WebCrypto, so on every runtime.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param claims The claims of the token.
	 * @param options The key, the lifetime and the registered claims.
	 * @example
	 * ```ts
	 * const token = await Jwt.sign({ role: 'admin' }, { secret: env.JWT_SECRET, subject: user.id, expiresIn: '15m' });
	 * ```
	 */
	export const sign = async (claims: JWTPayload, options: JwtSignOptions): Promise<string> => {
		const { key, algorithm } = keyOf(options);
		let jwt = new SignJWT(claims).setProtectedHeader({ alg: algorithm, typ: 'JWT' }).setIssuedAt();
		if (options.expiresIn !== undefined) {
			jwt = jwt.setExpirationTime(
				typeof options.expiresIn === 'number'
					? Math.floor(Date.now() / 1000) + options.expiresIn
					: options.expiresIn
			);
		}
		if (options.issuer) jwt = jwt.setIssuer(options.issuer);
		if (options.audience) jwt = jwt.setAudience(options.audience);
		if (options.subject) jwt = jwt.setSubject(options.subject);
		return jwt.sign(key);
	};

	/**
	 * Verifies a token and returns its claims.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param token The token.
	 * @param options The key, and the issuer and audience the token must carry.
	 * @throws {InvalidTokenError} When the token does not verify (401).
	 */
	export const verify = async <T extends JWTPayload = JWTPayload>(
		token: string,
		options: JwtVerifyOptions
	): Promise<T> => {
		const { key, algorithm } = keyOf(options);
		try {
			const { payload } = await jwtVerify(token, key, {
				algorithms: [algorithm],
				issuer: options.issuer,
				audience: options.audience,
				clockTolerance: options.clockTolerance ?? 5
			});
			return payload as T;
		} catch (error) {
			const code = (error as { code?: string }).code;
			throw new InvalidTokenError(
				code === 'ERR_JWT_EXPIRED'
					? 'it has expired'
					: code === 'ERR_JWT_CLAIM_VALIDATION_FAILED'
						? (error as Error).message
						: 'it does not verify'
			);
		}
	};
}
