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

import { DomainError, ElysiumError } from '@elysiumjs/core';

/**
 * Raised when a route needs an authenticated user and the request has none. Rendered as a 401
 * problem.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class UnauthenticatedError extends DomainError {
	constructor() {
		super({ status: 401, detail: 'Authentication is required.' });
	}
}

/**
 * Raised when an unsafe request of a cookie session carries no valid CSRF token. Rendered as a 403
 * problem.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class CsrfTokenMismatchError extends DomainError {
	constructor() {
		super({ status: 403, detail: 'The CSRF token is missing or does not match.' });
	}
}

/**
 * Raised when Themis is used without ThemisModule.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class MissingThemisConfigError extends ElysiumError {
	constructor() {
		super('Themis needs ThemisModule.with({ secret, ... }) in the application.');
	}
}

/**
 * Raised when the session is read outside a request, or without SessionMiddleware.
 * @author Axel Nana <axel.nana@workbud.com>
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
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class UnknownGuardError extends ElysiumError {
	constructor(name: string) {
		super(`No guard named "${name}" is configured in ThemisModule.with({ guards }).`);
	}
}
