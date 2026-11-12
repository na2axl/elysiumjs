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

import { ElysiumError } from '../index';

/**
 * A secret: its value, or a function that reads it when it is needed, such as from a secrets
 * store bound to the request. The function runs on every use, so that a rotated secret is picked
 * up; it caches the value itself when reading it is costly.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type Secret = string | (() => string | Promise<string>);

/**
 * The value of a secret, checked to be at least 32 bytes long.
 * @param secret The secret, or the function that reads it.
 * @param what What the secret is for, in the error message.
 * @throws {WeakSecretError} When the secret is too short.
 */
export const resolveSecret = async (secret: Secret, what: string): Promise<string> => {
	const value = typeof secret === 'function' ? await secret() : secret;
	assertStrongSecret(value, what);
	return value;
};

/**
 * Raised when a secret is shorter than 32 bytes, which would let an attacker forge cookies,
 * tokens or links by brute force.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class WeakSecretError extends ElysiumError {
	constructor(what: string) {
		super(
			`The ${what} must be at least ${MIN_SECRET_BYTES} bytes long: use a random value kept in an environment secret.`
		);
	}
}

/** The shortest secret accepted, in bytes. */
export const MIN_SECRET_BYTES = 32;

/**
 * Throws {@link WeakSecretError} for a secret under {@link MIN_SECRET_BYTES} bytes.
 * @param secret The secret.
 * @param what What the secret is for, in the message.
 */
export const assertStrongSecret = (secret: string, what: string): void => {
	if (new TextEncoder().encode(secret).length < MIN_SECRET_BYTES) throw new WeakSecretError(what);
};
