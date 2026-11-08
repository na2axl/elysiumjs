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

import { DomainError, ElysiumError, t, validationExtensions } from '@elysiumjs/core';

/**
 * Raised when an idempotent action is called without an idempotency key. Rendered as a 400
 * problem.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class IdempotencyKeyRequiredError extends DomainError.for('IDEMPOTENCY_KEY_REQUIRED', 400, {
	extensions: { action: t.String() }
}) {
	constructor(public readonly action: string) {
		super(`The ${action} action needs an Idempotency-Key.`, { extensions: { action } });
	}
}

/**
 * Raised when an idempotency key comes back with another action or another input. Rendered as a
 * 422 problem.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class IdempotencyKeyReusedError extends DomainError.for('IDEMPOTENCY_KEY_REUSED', 422, {
	extensions: { idempotencyKey: t.String() }
}) {
	constructor(public readonly key: string) {
		super('This Idempotency-Key was already used for another request.', {
			extensions: { idempotencyKey: key }
		});
	}
}

/**
 * Raised by an {@link IdempotencyStore} when another call stored the same key first. The action
 * retries, and replays the response of the call that won.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class IdempotencyConflictError extends ElysiumError {
	/** Conflicts are transient: the action retries them. */
	public readonly transient = true;

	constructor(public readonly key: string) {
		super(`The idempotency key ${key} was stored by another call.`);
	}
}

/**
 * Raised when the input of an action or a query does not match its schema. Rendered as a 422
 * problem, with one entry per mistake in `errors`.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class InvalidInputError extends DomainError.for('VALIDATION_FAILED', 422, {
	extensions: validationExtensions()
}) {
	constructor(
		public readonly target: string,
		errors: readonly ProblemValidationError[]
	) {
		super(`The input of ${target} is invalid.`, { errors });
	}
}

/**
 * Raised when the `authorize` hook of an action refuses the call. Rendered as a 403 problem.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class CallForbiddenError extends DomainError.for('FORBIDDEN', 403) {
	constructor(public readonly action: string) {
		super(`You may not run the ${action} action.`);
	}
}

/**
 * Raised when moirai needs a store that neither the current module (`Moirai.stores()`) nor
 * `MoiraiModule.with()` set.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class MissingStoreError extends ElysiumError {
	constructor(
		public readonly store: string,
		public readonly module?: string
	) {
		super(
			`Moirai has no ${store} store` +
				(module ? ` in module ${module}` : '') +
				`. Set one with MoiraiModule.with({ ${store}: ... }) in the application, or with ` +
				`Moirai.stores({ ${store}: ... }) in the services of the module.`
		);
	}
}

/**
 * Raised when an outbox row has a kind no `@Outbox.handle()` handles.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class UnknownEffectError extends ElysiumError {
	constructor(public readonly kind: string) {
		super(
			`No @Outbox.handle('${kind}') handles the outbox rows of kind "${kind}". Effects register when ` +
				'their module is imported, so the process that relays must import it' +
				(kind === 'heracles.job' ? " (here '@elysiumjs/moirai/heracles')." : '.')
		);
	}
}

/**
 * Raised when two event handlers have the same consumer name.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class DuplicateEventConsumerError extends ElysiumError {
	constructor(public readonly consumer: string) {
		super(`Two event handlers are named "${consumer}". Give one of them another consumer.`);
	}
}

/**
 * Raised when an event is delivered to a handler this process does not have. The delivery
 * retries, so a process that imports the handler later can still handle it.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class UnknownEventConsumerError extends ElysiumError {
	constructor(
		public readonly consumer: string,
		public readonly event: string
	) {
		super(
			`No @Event.on('${event}') handler is named "${consumer}" here. Handlers register ` +
				'when their module is imported, so the process that relays must import it.'
		);
	}
}
