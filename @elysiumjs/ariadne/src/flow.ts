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

import type { DomainError } from '@elysiumjs/core';
import type { Static, TSchema } from 'typebox';

import { InvalidFlowError } from './errors';

/**
 * What `initial` receives: the request, its context, and the flow.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type FlowContext = {
	readonly request: Request;
	/** The Elysia context of the request. */
	readonly http: Record<string, any>;
	/** The name of the flow. */
	readonly flow: string;
	readonly flowKey: string;
	/** The user id, or the guest token, that owns the flow. */
	readonly owner: string;
};

/**
 * What a step returns when it succeeds.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type FlowStepResult<S> = {
	/** The state the next step receives. It stays on the server. */
	state: S;
	/** What the client receives, replayed for a repeated step id. */
	answer: unknown;
	/** Ends the flow. */
	terminal?: boolean;
};

/**
 * A refused step that leaves a trace, built with {@link Flow.refuse}.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type FlowStepRefusal<S> = {
	readonly refused: DomainError;
	readonly state: S;
	readonly end: boolean;
};

/**
 * One step of a flow.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type FlowStep<S, B extends TSchema = TSchema> = {
	/** The schema of the step's body, besides `flowKey` and `stepId`. */
	body: B;
	/** The steps that may follow, given the state this step produced. */
	next: (state: S) => string[];
	/** Earlier steps the client may go back to, by submitting them again. */
	back?: string[];
	/** Runs on the state of a step submitted again through `back`, before the step itself. */
	onRewind?: (ctx: FlowContext, state: S) => S | Promise<S>;
	/**
	 * Runs the step. A returned or thrown error commits nothing, and the client may retry the same
	 * step id. A refusal does the same after keeping its state, or ends the flow.
	 */
	run: (
		ctx: FlowContext,
		state: S,
		body: Static<B>
	) => Promise<FlowStepResult<S> | FlowStepRefusal<S> | DomainError>;
};

/**
 * The declaration of a flow.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type FlowDefinition<S, Bodies extends Record<string, TSchema> = Record<string, TSchema>> = {
	/** The name of the flow, in kebab-case. It is the path of its routes. */
	name: string;
	/** How long the flow lives after its last step, in seconds. */
	ttlSeconds: number;
	/** `user`: owned by the signed-in user. `guest`: owned by a token returned at start. */
	owner: 'guest' | 'user';
	/** The state before the first step. */
	initial: (ctx: FlowContext) => S;
	/** The steps accepted first. Defaults to the first declared step. */
	start?: string[];
	steps: { [K in keyof Bodies]: FlowStep<S, Bodies[K]> };
};

/**
 * A flow, with its state type erased. The static type of each step's body is kept, so that a
 * client contract can be derived with {@link FlowBody}.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type AnyFlow<Bodies extends Record<string, TSchema> = Record<string, TSchema>> =
	FlowDefinition<unknown> & {
		readonly '~bodies'?: { [K in keyof Bodies]: Static<Bodies[K]> };
	};

/**
 * The body a client sends to step `K` of flow `F`.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type FlowBody<F, K extends string> = F extends { readonly '~bodies'?: infer B }
	? K extends keyof NonNullable<B>
		? NonNullable<B>[K]
		: never
	: never;

/**
 * Multi-step flows, such as a sign-up with a code check, whose state lives on the server between
 * steps.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export namespace Flow {
	/**
	 * Declares a flow, and checks it: a mistake in `start` or `back` fails at boot.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @example
	 * ```ts
	 * const signUp = Flow.define({
	 * 	name: 'sign-up',
	 * 	ttlSeconds: 900,
	 * 	owner: 'guest',
	 * 	initial: () => ({ attempts: 0 }),
	 * 	steps: {
	 * 		email: {
	 * 			body: t.Object({ email: t.String() }),
	 * 			next: () => ['code'],
	 * 			run: async (ctx, state, { email }) => ({ state: { ...state, email }, answer: { sent: true } })
	 * 		},
	 * 		code: {
	 * 			body: t.Object({ code: t.String() }),
	 * 			next: () => [],
	 * 			back: ['email'],
	 * 			run: async (ctx, state, { code }) => ({ state, answer: { ok: true }, terminal: true })
	 * 		}
	 * 	}
	 * });
	 * ```
	 */
	export const define = <S, Bodies extends Record<string, TSchema>>(
		definition: FlowDefinition<S, Bodies>
	): AnyFlow<Bodies> => {
		const names = Object.keys(definition.steps);
		if (names.length === 0) throw new InvalidFlowError(definition.name, 'has no steps');
		if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(definition.name)) {
			throw new InvalidFlowError(definition.name, 'needs a kebab-case name');
		}
		if (!(definition.ttlSeconds > 0)) {
			throw new InvalidFlowError(definition.name, 'needs a positive ttlSeconds');
		}
		const unknown = [
			...(definition.start ?? []),
			...Object.values<{ back?: string[] }>(definition.steps).flatMap((step) => step.back ?? [])
		].filter((name) => !names.includes(name));
		if (unknown.length > 0) {
			throw new InvalidFlowError(definition.name, `names unknown steps: ${unknown.join(', ')}`);
		}
		// Each step only ever receives the state its predecessor produced.
		return definition as unknown as AnyFlow<Bodies>;
	};

	/**
	 * Refuses a step with `error` and keeps `state`, such as one more wrong attempt. With `end`, the
	 * flow is deleted, and its next call answers that it expired.
	 * @author Axel Nana <axel.nana@workbud.com>
	 */
	export const refuse = <S>(
		state: S,
		error: DomainError,
		options: { end?: boolean } = {}
	): FlowStepRefusal<S> => ({ refused: error, state, end: options.end === true });

	/** Whether a step's result is a refusal. */
	export const isRefusal = (value: unknown): value is FlowStepRefusal<unknown> =>
		typeof value === 'object' && value !== null && 'refused' in value && 'end' in value;
}
