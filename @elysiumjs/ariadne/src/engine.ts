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

import type { AnyFlow, FlowContext } from './flow';
import type { FlowRecord, FlowStore } from './store';

import { DomainError, validationErrors } from '@elysiumjs/core';
import Value from 'typebox/value';

import {
	FlowCompletedError,
	FlowExpiredError,
	FlowForbiddenError,
	FlowStepInProgressError,
	FlowUnexpectedStepError,
	FlowUserRequiredError,
	InvalidFlowBodyError
} from './errors';
import { Flow } from './flow';
import { FLOW_OWNER_HEADER, FLOW_STEP_LEASE_SECONDS } from './store';

/**
 * The Elysia context a flow route reads.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type FlowHttpContext = {
	request: Request;
	body?: unknown;
	query?: Record<string, string | undefined>;
	set: { status?: number | string };
	[key: string]: any;
};

/**
 * How flows are served.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type FlowEngineOptions = {
	/** Where flows live. */
	store: FlowStore | (() => FlowStore);
	/**
	 * Runs before a flow starts and before its state is read, such as a rate limit by IP. A returned
	 * error is the answer.
	 */
	admit?: (ctx: {
		request: Request;
		http: FlowHttpContext;
		flow: string;
	}) => DomainError | undefined | void | Promise<DomainError | undefined | void>;
	/**
	 * The id of the signed-in user, which owns a user flow. Defaults to the `id` of `currentUser`
	 * in the context, which `@Auth()` of themis sets.
	 */
	user?: (http: FlowHttpContext) => string | undefined;
};

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

const defaultUser = (http: FlowHttpContext): string | undefined => {
	const id = (http.currentUser as { id?: unknown } | undefined)?.id;
	return id === undefined || id === null ? undefined : String(id);
};

const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

/**
 * Starts flows, reads where they stand and runs their steps, for the routes of one flow.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class FlowEngine {
	constructor(
		private readonly flow: AnyFlow,
		private readonly options: FlowEngineOptions
	) {}

	private get store(): FlowStore {
		const { store } = this.options;
		return typeof store === 'function' ? store() : store;
	}

	private key(flowKey: string): string {
		return `${this.flow.name}:${flowKey}`;
	}

	/** The steps the flow accepts next, and the earlier ones it may go back to. */
	private position(record: FlowRecord): { next: string[]; back: string[] } {
		if (record.step === null) {
			return { next: this.flow.start ?? Object.keys(this.flow.steps).slice(0, 1), back: [] };
		}
		const current = this.flow.steps[record.step];
		if (!current) return { next: [], back: [] };
		return { next: current.next(record.state), back: current.back ?? [] };
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

	private async admit(http: FlowHttpContext): Promise<void> {
		const refused = await this.options.admit?.({
			request: http.request,
			http,
			flow: this.flow.name
		});
		if (refused) throw refused;
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
	) {
		if (reason === 'completed') return new FlowCompletedError();
		if (reason === 'missing') return new FlowExpiredError();
		return new FlowUnexpectedStepError(step, this.position(record), record.lastAnswer);
	}

	/** `POST /{flow}`: starts a flow, and answers its key (and the owner token of a guest flow). */
	public async start(http: FlowHttpContext) {
		await this.admit(http);
		const owner = this.flow.owner === 'user' ? this.user(http) : randomToken();
		const flowKey = crypto.randomUUID();
		await this.store.init(this.key(flowKey), owner, this.flow.ttlSeconds);
		http.set.status = 201;
		return {
			flowKey,
			...(this.flow.owner === 'guest' ? { owner } : {}),
			nextSteps: this.flow.start ?? Object.keys(this.flow.steps).slice(0, 1),
			backSteps: []
		};
	}

	/** `GET /{flow}?flowKey=`: where the flow stands, and the last answer. */
	public async state(http: FlowHttpContext) {
		const flowKey = http.query?.flowKey;
		if (!nonEmpty(flowKey)) {
			throw new InvalidFlowBodyError([{ pointer: '/query/flowKey', message: 'is required' }]);
		}
		await this.admit(http);
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

	/** `POST /{flow}/{step}`: runs a step, body `{ flowKey, stepId, ...body }`. */
	public async step(http: FlowHttpContext, stepName: string) {
		const target = this.flow.steps[stepName]!;
		const fields = (
			typeof http.body === 'object' && http.body !== null && !Array.isArray(http.body)
				? http.body
				: {}
		) as Record<string, unknown>;
		const { flowKey, stepId, ...rest } = fields;
		const missing = [
			...(nonEmpty(flowKey) ? [] : [{ pointer: '/body/flowKey', message: 'is required' }]),
			...(nonEmpty(stepId) ? [] : [{ pointer: '/body/stepId', message: 'is required' }])
		];
		if (missing.length > 0 || !nonEmpty(flowKey) || !nonEmpty(stepId)) {
			throw new InvalidFlowBodyError(missing);
		}

		const store = this.store;
		const key = this.key(flowKey);
		const record = await this.owned(http, flowKey);
		const repeat = record.lastStepId === stepId;
		if (record.completedAt !== null && !repeat) throw new FlowCompletedError();

		const input = Value.Default(target.body, structuredClone(rest));
		const errors = [...Value.Errors(target.body, input)];
		if (errors.length > 0) throw new InvalidFlowBodyError(validationErrors('body', errors));

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
			leaseSeconds: FLOW_STEP_LEASE_SECONDS
		});
		if (!claim.ok) {
			if (claim.reason === 'replay') return this.reply(claim.answer, await store.load(key));
			if (claim.reason === 'in-flight') throw new FlowStepInProgressError();
			throw this.refusal(claim.reason, (await store.load(key)) ?? record, stepName);
		}

		const ctx: FlowContext = {
			request: http.request,
			http,
			flow: this.flow.name,
			flowKey,
			owner: record.owner
		};
		let settled = false;
		try {
			const before = record.step === null ? this.flow.initial(ctx) : record.state;
			const state = rewinding && target.onRewind ? await target.onRewind(ctx, before) : before;
			const result = await target.run(ctx, state, input);
			if (result instanceof DomainError) throw result;
			if (Flow.isRefusal(result)) {
				// The claim is given back by amend.
				await store.amend(key, { stepId, state: result.state, end: result.end });
				settled = true;
				throw result.refused;
			}
			const committed = await store.commit(key, {
				stepId,
				step: stepName,
				expectStep: record.step,
				state: result.state,
				answer: result.answer,
				terminal: result.terminal === true,
				ttlSeconds: this.flow.ttlSeconds
			});
			if (!committed.ok)
				throw this.refusal(committed.reason, (await store.load(key)) ?? record, stepName);
			settled = true;
			if (result.terminal === true)
				return { answer: committed.answer, nextSteps: [], backSteps: [] };
			return {
				answer: committed.answer,
				nextSteps: target.next(result.state),
				backSteps: target.back ?? []
			};
		} finally {
			if (!settled) await store.release(key, stepId);
		}
	}
}
