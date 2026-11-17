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

import type { ProblemValidationError, Static, TSchema } from '../index.js';

import Value from 'typebox/value';

import { InvalidWorkflowError } from './errors.js';

/**
 * An event a workflow waits for with `step.waitFor()`, and that `Odysseus.signal()` sends: its
 * type and the schema of its payload.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @template T The type of the event.
 * @template S The schema of the payload.
 */
export type WorkflowEvent<T extends string = string, S extends TSchema = TSchema> = {
	readonly '~workflowEvent': true;
	/** The type of the event: 1 to 100 letters, digits, `_` or `-`. */
	readonly type: T;
	/** The schema of the payload, checked when the event is sent. */
	readonly schema: S;
};

/** The payload of a {@link WorkflowEvent}. */
export type WorkflowEventPayload<E extends WorkflowEvent> = Static<E['schema']>;

/** The longest event type: the limit of Cloudflare Workflows, so that a workflow runs on every driver. */
const MAX_TYPE_LENGTH = 100;

export namespace WorkflowEvent {
	/**
	 * Declares an event.
	 * @param type The type of the event: 1 to 100 letters, digits, `_` or `-` (the characters
	 * Cloudflare Workflows takes, so that a workflow runs on every driver).
	 * @param schema The schema of the payload.
	 * @throws {InvalidWorkflowError} When the type is empty, too long, or holds other characters.
	 * @example
	 * ```ts
	 * export const PaymentSettled = WorkflowEvent.define(
	 * 	'payment-settled',
	 * 	t.Object({ paymentId: t.String(), status: t.Union([t.Literal('paid'), t.Literal('failed')]) })
	 * );
	 * ```
	 */
	export const define = <const T extends string, S extends TSchema>(
		type: T,
		schema: S
	): WorkflowEvent<T, S> => {
		if (!/^[A-Za-z0-9_][A-Za-z0-9_-]*$/.test(type) || type.length > MAX_TYPE_LENGTH) {
			throw new InvalidWorkflowError(
				type,
				`has an event type that is not 1 to ${MAX_TYPE_LENGTH} letters, digits, "_" or "-", not starting with "-"`
			);
		}
		return { '~workflowEvent': true, type, schema };
	};

	/**
	 * Checks a payload against the schema of an event, after its defaults are applied.
	 * @param event The event.
	 * @param payload The payload.
	 * @returns The payload with its defaults, or the invalid values.
	 */
	export const check = <E extends WorkflowEvent>(
		event: E,
		payload: unknown
	):
		| { ok: true; payload: WorkflowEventPayload<E> }
		| { ok: false; errors: ProblemValidationError[] } => {
		const value = Value.Default(event.schema, structuredClone(payload));
		const errors = [...Value.Errors(event.schema, value)];
		if (errors.length === 0) return { ok: true, payload: value as WorkflowEventPayload<E> };
		return {
			ok: false,
			errors: errors.map((error) => ({
				pointer: `/payload${(error as { instancePath?: string }).instancePath ?? ''}`,
				message: error.message
			}))
		};
	};
}
