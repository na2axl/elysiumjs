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

import { DomainError, ElysiumError } from '@elysiumjs/core';

export { UnauthenticatedError } from '@elysiumjs/core';

/**
 * Raised when an unsafe request of a cookie session carries no valid CSRF token. Rendered as a 403
 * problem.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class CsrfTokenMismatchError extends DomainError.for('CSRF_TOKEN_MISMATCH', 403) {
	constructor() {
		super('The CSRF token is missing or does not match.');
	}
}

/**
 * Raised when Themis is used without ThemisModule.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class MissingThemisConfigError extends ElysiumError {
	constructor() {
		super('Themis needs ThemisModule.with({ secret, ... }) in the application.');
	}
}

/**
 * Raised when the session is read outside a request, or without SessionMiddleware.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class NoSessionError extends ElysiumError {
	constructor() {
		super(
			'There is no session here. Register SessionMiddleware on the application or the controller (@Middleware.register(SessionMiddleware)).'
		);
	}
}

/**
 * Raised when `@Auth()` names a guard that ThemisModule does not configure.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class UnknownGuardError extends ElysiumError {
	constructor(name: string) {
		super(`No guard named "${name}" is configured in ThemisModule.with({ guards }).`);
	}
}

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

/** The shortest secret themis accepts, in bytes. */
export const MIN_SECRET_BYTES = 32;

/**
 * Throws {@link WeakSecretError} for a secret under {@link MIN_SECRET_BYTES} bytes.
 * @param secret The secret.
 * @param what What the secret is for, in the message.
 */
export const assertStrongSecret = (secret: string, what: string): void => {
	if (new TextEncoder().encode(secret).length < MIN_SECRET_BYTES) throw new WeakSecretError(what);
};

/**
 * Raised when a cookie session grows past what browsers keep (about 4 KB), which would silently
 * lose it. Keep large data in a session store instead.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class SessionTooLargeError extends ElysiumError {
	constructor(size: number) {
		super(
			`The cookie session is ${size} characters long, over the 4000 browsers keep. Keep less in it, or use a session store.`
		);
	}
}
