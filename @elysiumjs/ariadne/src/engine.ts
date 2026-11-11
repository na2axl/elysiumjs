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

import type { FlowAdvance, FlowContext, FlowDescription, FlowRefusal, FlowStepRun } from './flow';
import type { FlowRecord, FlowStore } from './store';

import { DomainError, Http, Result, Service, userIdOf } from '@elysiumjs/core';

import {
	FlowCompletedError,
	FlowExpiredError,
	FlowForbiddenError,
	FlowStepInProgressError,
	FlowUnexpectedStepError,
	FlowUserRequiredError,
	InvalidFlowError,
	InvalidFlowRequestError,
	MissingFlowStoreError
} from './errors';
import { FLOW_KEY_HEADER, FLOW_OWNER_HEADER, FLOW_STEP_HEADER } from './store';

/**
 * The Elysia context the flow routes read.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type FlowHttpContext = {
	request: Request;
	query?: Record<string, string | undefined>;
	set: { status?: number | string };
	[key: string]: any;
};

/**
 * How flows are served, set by `AriadneModule.with()`.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type FlowOptions = {
	/** Where flows live. */
	store: FlowStore | (() => FlowStore);
	/**
	 * The id of the signed-in user, which owns a user flow. Defaults to `currentUser` in the
	 * context, which `@Auth()` of themis sets: the user when it is a string, else its `id`, else
	 * its `sub`.
	 */
	user?: (http: FlowHttpContext) => string | undefined;
};

/** The injection token of the {@link FlowOptions}. */
export const ARIADNE_OPTIONS = 'ariadne.options';

const encoder = new TextEncoder();

/** Compares two strings in a time that does not depend on where they differ. */
const safeEqual = (a: string, b: string): boolean => {
	const left = encoder.encode(a);
	const right = encoder.encode(b);
	let diff = left.length ^ right.length;
	for (let i = 0; i < left.length; i++) diff |= left[i]! ^ (right[i % right.length] ?? 0);
	return diff === 0;
};

const randomToken = (): string =>
	Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
		byte.toString(16).padStart(2, '0')
	).join('');

const defaultUser = (http: FlowHttpContext): string | undefined => userIdOf(http.currentUser);

const isAdvance = (value: unknown): value is FlowAdvance<unknown> =>
	(value as { '~flow'?: unknown } | null)?.['~flow'] === 'advance';

const isRefusal = (value: unknown): value is FlowRefusal<unknown> =>
	(value as { '~flow'?: unknown } | null)?.['~flow'] === 'refuse';

const engines = new WeakMap<FlowDescription, FlowEngine>();

/**
 * Starts flows, reads where they stand and runs their steps, for one flow controller.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class FlowEngine {
	/** The engine of a flow. */
	public static of(description: FlowDescription): FlowEngine {
		let engine = engines.get(description);
		if (!engine) engines.set(description, (engine = new FlowEngine(description)));
		return engine;
	}

	constructor(private readonly flow: FlowDescription) {
		engines.set(flow, this);
	}

	private get options(): FlowOptions {
		const options = Service.exists(ARIADNE_OPTIONS)
			? Service.get<FlowOptions>(ARIADNE_OPTIONS)
			: null;
		if (!options) throw new MissingFlowStoreError();
		return options;
	}

	private get store(): FlowStore {
		const { store } = this.options;
		return typeof store === 'function' ? store() : store;
	}

	private key(flowKey: string): string {
		return `${this.flow.name}:${flowKey}`;
	}

	/** The steps the flow accepts next, and the earlier ones it may go back to. */
	private position(record: FlowRecord): { next: string[]; back: string[] } {
		if (record.step === null) return { next: this.flow.start, back: [] };
		const current = this.flow.steps.get(record.step);
		if (!current) return { next: [], back: [] };
		return { next: current.next(record.state), back: current.back };
	}

	private reply(answer: unknown, record: FlowRecord | null) {
		if (record === null || record.completedAt !== null) {
			return { answer, nextSteps: [], backSteps: [] };
		}
		const { next, back } = this.position(record);
		return { answer, nextSteps: next, backSteps: back };
	}

	private user(http: FlowHttpContext): string {
		const user = (this.options.user ?? defaultUser)(http);
		if (user === undefined) throw new FlowUserRequiredError();
		return user;
	}

	/** Loads a flow the caller owns, or throws: 410 when it expired, 403 when it is not theirs. */
	private async owned(http: FlowHttpContext, flowKey: string): Promise<FlowRecord> {
		const record = await this.store.load(this.key(flowKey));
		if (record === null) throw new FlowExpiredError();
		const presented =
			this.flow.owner === 'user'
				? this.user(http)
				: (http.request.headers.get(FLOW_OWNER_HEADER) ?? '');
		if (!safeEqual(presented, record.owner)) throw new FlowForbiddenError();
		return record;
	}

	private refusal(
		reason: 'unexpected-step' | 'completed' | 'missing',
		record: FlowRecord,
		step: string
	): DomainError {
		if (reason === 'completed') return new FlowCompletedError();
		if (reason === 'missing') return new FlowExpiredError();
		return new FlowUnexpectedStepError(step, this.position(record), record.lastAnswer);
	}

	/** How long the flow lives after its last step, in seconds. */
	private ttl(): number {
		const { ttl, name } = this.flow;
		const seconds = typeof ttl === 'function' ? ttl() : ttl;
		if (!(seconds > 0)) throw new InvalidFlowError(name, 'needs a positive ttl');
		return seconds;
	}

	/** `POST /flows/{flow}`: starts a flow, and answers its key (and the owner token of a guest flow). */
	public async start(http: FlowHttpContext, _controller: object) {
		const owner = this.flow.owner === 'user' ? this.user(http) : randomToken();
		const flowKey = crypto.randomUUID();
		await this.store.init(this.key(flowKey), owner, this.ttl());
		http.set.status = 201;
		return {
			flowKey,
			...(this.flow.owner === 'guest' ? { owner } : {}),
			nextSteps: this.flow.start,
			backSteps: []
		};
	}

	/** `GET /flows/{flow}`: where the flow of the `x-flow-key` header stands, and the last answer. */
	public async state(http: FlowHttpContext) {
		const flowKey = http.request.headers.get(FLOW_KEY_HEADER) ?? http.query?.flowKey ?? '';
		if (flowKey === '') {
			throw new InvalidFlowRequestError([
				{ pointer: `/headers/${FLOW_KEY_HEADER}`, message: 'is required' }
			]);
		}
		const record = await this.owned(http, flowKey);
		if (record.completedAt !== null) throw new FlowCompletedError();
		const { next, back } = this.position(record);
		return {
			flowKey,
			step: record.step,
			nextSteps: next,
			backSteps: back,
			answer: record.lastAnswer
		};
	}

	/**
	 * Runs a step for the request in the application context: claims it, gives `run` the state,
	 * and commits what it returns. A repeated step id replays the stored answer.
	 */
	public async step(
		stepName: string,
		controller: object,
		run: (input: FlowStepRun) => unknown
	): Promise<{ answer: unknown; nextSteps: string[]; backSteps: string[] }> {
		const http = Http.currentContext<FlowHttpContext>()!;
		const target = this.flow.steps.get(stepName)!;
		const flowKey = http.request.headers.get(FLOW_KEY_HEADER) ?? '';
		const stepId = http.request.headers.get(FLOW_STEP_HEADER) ?? '';
		const missing = [
			...(flowKey ? [] : [{ pointer: `/headers/${FLOW_KEY_HEADER}`, message: 'is required' }]),
			...(stepId ? [] : [{ pointer: `/headers/${FLOW_STEP_HEADER}`, message: 'is required' }])
		];
		if (missing.length > 0) throw new InvalidFlowRequestError(missing);

		const store = this.store;
		const key = this.key(flowKey);
		const record = await this.owned(http, flowKey);
		const repeat = record.lastStepId === stepId;
		if (record.completedAt !== null && !repeat) throw new FlowCompletedError();

		const { next, back } = this.position(record);
		const rewinding = !next.includes(stepName) && back.includes(stepName);
		// The store judges a repeat of the last step id: a replay, or the wrong step.
		if (!repeat && !next.includes(stepName) && !rewinding) {
			throw new FlowUnexpectedStepError(stepName, { next, back }, record.lastAnswer);
		}

		const claim = await store.claim(key, {
			stepId,
			step: stepName,
			expectStep: record.step,
			leaseSeconds: target.lease
		});
		if (!claim.ok) {
			if (claim.reason === 'replay') return this.reply(claim.answer, await store.load(key));
			if (claim.reason === 'in-flight') throw new FlowStepInProgressError();
			throw this.refusal(claim.reason, (await store.load(key)) ?? record, stepName);
		}

		const ctx: FlowContext = {
			flow: this.flow.name,
			flowKey,
			stepId,
			step: stepName,
			owner: record.owner
		};
		let settled = false;
		try {
			const initial = this.flow.initial;
			// The state the store held when the step was reserved: a refused attempt may have
			// changed it since the flow was loaded. A flow that no step has touched yet starts from
			// its initial state.
			const before =
				record.step === null && claim.state === null
					? initial !== undefined
						? await (controller as Record<string | symbol, Function>)[initial]!.call(
								controller,
								ctx
							)
						: {}
					: claim.state;
			const state = rewinding && target.onRewind ? await target.onRewind(before, ctx) : before;
			const given = await run({ state, ctx });
			// A returned DomainError, or a failed Result, refuses the step like a thrown one:
			// nothing is committed. A passed Result gives its value.
			const result = Result.is(given) ? given.orThrow() : given;
			if (result instanceof DomainError) throw result;
			if (isRefusal(result)) {
				// The claim is given back by amend.
				await store.amend(key, { stepId, state: result.state, end: result.end });
				settled = true;
				throw result.refused;
			}
			const advance = isAdvance(result) ? result : { state, answer: result ?? null };
			// A step that leads nowhere ends the flow.
			const nextSteps = target.next(advance.state);
			const terminal = nextSteps.length === 0;
			const committed = await store.commit(key, {
				stepId,
				step: stepName,
				expectStep: record.step,
				state: advance.state,
				answer: advance.answer,
				terminal,
				ttlSeconds: this.ttl()
			});
			if (!committed.ok) {
				throw this.refusal(committed.reason, (await store.load(key)) ?? record, stepName);
			}
			settled = true;
			return { answer: committed.answer, nextSteps, backSteps: terminal ? [] : target.back };
		} finally {
			if (!settled) await store.release(key, stepId);
		}
	}
}
