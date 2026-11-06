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

import type { ProblemValidationError } from '@elysiumjs/core';

import { DomainError, ElysiumError } from '@elysiumjs/core';

/**
 * Raised when an idempotent command is called without an idempotency key. Rendered as a 428
 * problem.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class IdempotencyKeyRequiredError extends DomainError.for('IDEMPOTENCY_KEY_REQUIRED', 428) {
	constructor(public readonly command: string) {
		super(`The ${command} command needs an Idempotency-Key.`, { extensions: { command } });
	}
}

/**
 * Raised when an idempotency key comes back with another command or another input. Rendered as a
 * 422 problem.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class IdempotencyKeyReusedError extends DomainError.for('IDEMPOTENCY_KEY_REUSED', 422) {
	constructor(public readonly key: string) {
		super('This Idempotency-Key was already used for another request.', {
			extensions: { idempotencyKey: key }
		});
	}
}

/**
 * Raised by an {@link IdempotencyStore} when another call stored the same key first. The command
 * retries, and replays the response of the call that won.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class IdempotencyConflictError extends ElysiumError {
	/** Conflicts are transient: the command retries them. */
	public readonly transient = true;

	constructor(public readonly key: string) {
		super(`The idempotency key ${key} was stored by another call.`);
	}
}

/**
 * Raised when the input of a command or a query does not match its schema. Rendered as a 400
 * problem, with one entry per mistake in `errors`.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class InvalidInputError extends DomainError.for('VALIDATION_FAILED', 400) {
	constructor(
		public readonly target: string,
		errors: readonly ProblemValidationError[]
	) {
		super(`The input of ${target} is invalid.`, { errors });
	}
}

/**
 * Raised when the `authorize` hook of a command refuses the call. Rendered as a 403 problem.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class CommandForbiddenError extends DomainError.for('FORBIDDEN', 403) {
	constructor(public readonly command: string) {
		super(`You may not run the ${command} command.`);
	}
}

/**
 * Raised when moirai needs a store that `MoiraiModule.with()` did not set.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class MissingStoreError extends ElysiumError {
	constructor(store: string) {
		super(
			`Moirai has no ${store} store. Set one with MoiraiModule.with({ ${store}: ... }) in the application.`
		);
	}
}

/**
 * Raised when an outbox row has a kind no `@Moirai.effect()` handles.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class UnknownEffectError extends ElysiumError {
	constructor(public readonly kind: string) {
		super(
			`No @Moirai.effect('${kind}') handles the outbox rows of kind "${kind}". Effects register when ` +
				'their module is imported, so the process that relays must import it' +
				(kind === 'heracles.job' ? " (here '@elysiumjs/moirai/heracles')." : '.')
		);
	}
}
