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

import type { Secret } from './secret';

import { Clock, DomainError } from '@elysiumjs/core';

import { hmac, verifyHmac } from './crypto';
import { resolveSecret } from './secret';

/**
 * Raised when a signed URL was tampered with or has expired. Rendered as a 403 problem.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class InvalidSignatureError extends DomainError.for('INVALID_SIGNATURE', 403) {
	constructor(expired: boolean) {
		super(expired ? 'This link has expired.' : 'This link is not valid.');
	}
}

/** The URL without its signature, with its parameters sorted, as it is signed. */
const signedPart = (url: URL): string => {
	const copy = new URL(url);
	copy.searchParams.delete('signature');
	copy.searchParams.sort();
	return `${copy.pathname}?${copy.searchParams.toString()}`;
};

export namespace SignedUrl {
	/**
	 * Signs a URL with HMAC-SHA256: adds `expires` (when asked) and `signature` parameters. The
	 * path and every parameter are signed; the origin is not, so that the link works behind any
	 * host name.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param url The URL.
	 * @param options The secret, and how long the link lives, in seconds.
	 * @example
	 * ```ts
	 * const link = await SignedUrl.sign(`${base}/invoices/42/pdf`, { secret, expiresIn: 3600 });
	 * ```
	 */
	export const sign = async (
		url: string | URL,
		options: { secret: Secret; expiresIn?: number }
	): Promise<string> => {
		const target = new URL(url);
		target.searchParams.delete('signature');
		if (options.expiresIn !== undefined) {
			target.searchParams.set(
				'expires',
				String(Math.floor(Clock.epochMs() / 1000) + options.expiresIn)
			);
		}
		const secret = await resolveSecret(options.secret, 'signed URL secret');
		target.searchParams.set('signature', await hmac(secret, signedPart(target)));
		return target.toString();
	};

	/**
	 * Whether a URL carries a valid signature and has not expired.
	 * @author Axel Nana <axel.nana@workbud.com>
	 */
	export const verify = async (
		url: string | URL,
		options: { secret: Secret }
	): Promise<boolean> => {
		try {
			await assert(url, options);
			return true;
		} catch {
			return false;
		}
	};

	/**
	 * Checks the signature of a URL, such as `request.url` in a handler.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @throws {InvalidSignatureError} When the URL was tampered with or has expired (403).
	 */
	export const assert = async (url: string | URL, options: { secret: Secret }): Promise<void> => {
		const target = new URL(url);
		const signature = target.searchParams.get('signature');
		const secret = await resolveSecret(options.secret, 'signed URL secret');
		if (!signature || !(await verifyHmac(secret, signedPart(target), signature))) {
			throw new InvalidSignatureError(false);
		}
		const expires = target.searchParams.get('expires');
		if (expires !== null && Number(expires) * 1000 < Clock.epochMs())
			throw new InvalidSignatureError(true);
	};
}
