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

import type {
	DomainError,
	HttpControllerProps,
	RequestHandlerDecoratorProps
} from '@elysiumjs/core';

import { Http, Metadata } from '@elysiumjs/core';

import { FlowEngine } from './engine';
import { InvalidFlowError } from './errors';

/**
 * What a step learns about its flow, through {@link Flow.context}.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type FlowContext = {
	/** The name of the flow. */
	readonly flow: string;
	readonly flowKey: string;
	/** The id of this submission, from the `x-flow-step` header. */
	readonly stepId: string;
	/** The step being run. */
	readonly step: string;
	/** The user id, or the guest token, that owns the flow. */
	readonly owner: string;
};

/**
 * A step that moves the flow forward, built with {@link Flow.advance}.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type FlowAdvance<S> = {
	readonly '~flow': 'advance';
	readonly state: S;
	readonly answer: unknown;
};

/**
 * A refused step that leaves a trace, built with {@link Flow.refuse}.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type FlowRefusal<S> = {
	readonly '~flow': 'refuse';
	readonly refused: DomainError;
	readonly state: S;
	readonly end: boolean;
};

/**
 * The options of {@link Flow.controller}. The other options of `@Http.controller()` (scope, tags,
 * filters, interceptors, ...) apply too.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type FlowControllerOptions = Omit<HttpControllerProps, 'path'> & {
	/** The name of the flow, in kebab-case. */
	name: string;
	/** The path of the flow's routes. Defaults to `/flows/{name}`. */
	path?: string;
	/** How long the flow lives after its last step, in seconds. */
	ttl: number;
	/** `user`: owned by the signed-in user. `guest`: owned by a token answered at start. */
	owner: 'guest' | 'user';
	/** The steps accepted first. Defaults to the first declared step. */
	start?: string[];
};

/**
 * The options of {@link Flow.step}. The other options of the `@Http.*()` route decorators
 * (response, operationId, description, transactional, ...) apply too.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type FlowStepOptions<S = any> = Omit<RequestHandlerDecoratorProps, 'method' | 'path'> & {
	/** The name of the step, and the last segment of its path. Defaults to the method name. */
	name?: string;
	/**
	 * The steps that may follow, or a function of the state the step produced. The flow ends when
	 * they are none, which is the default.
	 */
	next?: string[] | ((state: S) => string[]);
	/** Earlier steps the client may go back to, by submitting them again. */
	back?: string[];
	/** Runs on the state of a step submitted again through `back`, before the step itself. */
	onRewind?: (state: S, ctx: FlowContext) => S | Promise<S>;
};

/**
 * One step, as the engine runs it.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type FlowStepDescription = {
	name: string;
	next: (state: unknown) => string[];
	back: string[];
	onRewind?: (state: unknown, ctx: FlowContext) => unknown;
};

/**
 * A flow controller, as the engine runs it.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type FlowDescription = {
	name: string;
	ttl: number;
	owner: 'guest' | 'user';
	start: string[];
	steps: Map<string, FlowStepDescription>;
	/** The method that builds the state before the first step. */
	initial?: string | symbol;
};

const STEPS = Symbol('ariadne:steps');
const INITIAL = Symbol('ariadne:initial');
const STATE_PARAMETER = 'ariadne:state';
const CONTEXT_PARAMETER = 'ariadne:context';
const DESCRIPTION = Symbol('ariadne:flow');

/** The state and the context of the step being run, read by the wrapped step method. */
export type FlowStepRun = { state: unknown; ctx: FlowContext };

/**
 * Multi-step flows, as controllers: each step is a route, and the state of the flow stays on the
 * server between steps.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export namespace Flow {
	/**
	 * Declares a flow controller: an `@Http.controller()` with a route that starts the flow
	 * (`POST /flows/{name}`), one that tells where it stands (`GET /flows/{name}`), and one route per
	 * `@Flow.step()`.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @example
	 * ```ts
	 * @Flow.controller({ name: 'sign-up', ttl: 900, owner: 'guest' })
	 * class SignUpFlow {
	 * 	@Flow.initial()
	 * 	public initial() {
	 * 		return { attempts: 0 };
	 * 	}
	 *
	 * 	@Flow.step({ next: ['code'] })
	 * 	public email(@Http.body(EmailBody) { email }: EmailBody, @Flow.state() state: SignUpState) {
	 * 		return Flow.advance({ ...state, email }, { sentTo: email });
	 * 	}
	 * }
	 * ```
	 */
	export const controller = (options: FlowControllerOptions): ClassDecorator => {
		return (target) => {
			const { name, path, ttl, owner, start, ...http } = options;
			if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) {
				throw new InvalidFlowError(name, 'needs a kebab-case name');
			}
			if (!(ttl > 0)) throw new InvalidFlowError(name, 'needs a positive ttl');
			const steps: Map<string, FlowStepDescription> =
				Metadata.get(STEPS, target.prototype) ?? new Map();
			if (steps.size === 0) throw new InvalidFlowError(name, 'has no steps');
			const unknown = [
				...(start ?? []),
				...[...steps.values()].flatMap((step) => step.back)
			].filter((step) => !steps.has(step));
			if (unknown.length > 0) {
				throw new InvalidFlowError(name, `names unknown steps: ${unknown.join(', ')}`);
			}

			const description: FlowDescription = {
				name,
				ttl,
				owner,
				start: start ?? [...steps.keys()].slice(0, 1),
				steps,
				initial: Metadata.get(INITIAL, target.prototype)
			};
			Metadata.define(DESCRIPTION, description, target);
			const engine = new FlowEngine(description);

			const proto = target.prototype as Record<string, unknown>;
			const route = (key: string, decorator: MethodDecorator, handler: Function) => {
				Object.defineProperty(proto, key, { value: handler, configurable: true, writable: true });
				Http.context()(proto, key, 0);
				decorator(proto, key, Object.getOwnPropertyDescriptor(proto, key)!);
			};
			route('ariadne:start', Http.post({ path: '/' }), function (this: object, http: any) {
				return engine.start(http, this);
			});
			route('ariadne:state', Http.get({ path: '/' }), (http: any) => engine.state(http));

			Http.controller({ ...http, path: (path ?? `/flows/${name}`) as `/${string}` })(target as any);
		};
	};

	/**
	 * Declares a step: a `POST /{step}` route of the flow controller, which runs once per step id.
	 * The `@Http.*()` parameter decorators work on it, and `@Flow.state()` and `@Flow.context()`
	 * give the state and the flow.
	 *
	 * The step returns {@link advance}, {@link refuse}, or an answer that keeps the state. A thrown
	 * error commits nothing, and the client may retry the same step id.
	 * @author Axel Nana <axel.nana@workbud.com>
	 */
	export const step = <S = any>(options: FlowStepOptions<S> = {}): MethodDecorator => {
		return (target, key, descriptor) => {
			const { name: stepName, next, back, onRewind, ...http } = options;
			const name = stepName ?? String(key);
			const steps: Map<string, FlowStepDescription> = new Map(Metadata.get(STEPS, target) ?? []);
			steps.set(name, {
				name,
				next:
					typeof next === 'function' ? (next as (state: unknown) => string[]) : () => next ?? [],
				back: back ?? [],
				onRewind: onRewind as FlowStepDescription['onRewind']
			});
			Metadata.define(STEPS, steps, target);

			const original = descriptor.value as unknown as (...args: unknown[]) => unknown;
			const stateIndex: number | undefined = Metadata.get(STATE_PARAMETER, target, key);
			const contextIndex: number | undefined = Metadata.get(CONTEXT_PARAMETER, target, key);
			const wrapped = function (this: object, ...args: unknown[]) {
				const description: FlowDescription = Metadata.get(DESCRIPTION, this.constructor);
				return FlowEngine.of(description).step(name, this, ({ state, ctx }: FlowStepRun) => {
					if (stateIndex !== undefined) args[stateIndex] = state;
					if (contextIndex !== undefined) args[contextIndex] = ctx;
					return original.apply(this, args);
				});
			};
			Object.defineProperty(wrapped, 'name', { value: original.name });
			(descriptor as PropertyDescriptor).value = wrapped;
			Http.post({ ...http, path: `/${name}` })(target, key, descriptor);
		};
	};

	/**
	 * Marks the method that builds the state before the first step. It receives the
	 * {@link FlowContext} of the first step. Without one, the state starts as `{}`.
	 * @author Axel Nana <axel.nana@workbud.com>
	 */
	export const initial = (): MethodDecorator => {
		return (target, key) => {
			Metadata.define(INITIAL, key, target);
		};
	};

	/**
	 * Injects the state of the flow, as the step finds it, in a step parameter.
	 * @author Axel Nana <axel.nana@workbud.com>
	 */
	export const state = (): ParameterDecorator => {
		return (target, key, index) => {
			Metadata.define(STATE_PARAMETER, index, target, key!);
		};
	};

	/**
	 * Injects the {@link FlowContext} (flow, key, step id, owner) in a step parameter.
	 * @author Axel Nana <axel.nana@workbud.com>
	 */
	export const context = (): ParameterDecorator => {
		return (target, key, index) => {
			Metadata.define(CONTEXT_PARAMETER, index, target, key!);
		};
	};

	/**
	 * Moves the flow forward: `state` is what the next step receives, and `answer` what the client
	 * receives, replayed for a repeated step id. The flow ends when the `next` of the step gives no
	 * step for `state`.
	 * @author Axel Nana <axel.nana@workbud.com>
	 */
	export const advance = <S>(state: S, answer: unknown = null): FlowAdvance<S> => ({
		'~flow': 'advance',
		state,
		answer
	});

	/**
	 * Refuses a step with `error` and keeps `state`, such as one more wrong attempt. With `end`, the
	 * flow is deleted, and its next call answers that it expired.
	 * @author Axel Nana <axel.nana@workbud.com>
	 */
	export const refuse = <S>(
		state: S,
		error: DomainError,
		options: { end?: boolean } = {}
	): FlowRefusal<S> => ({ '~flow': 'refuse', refused: error, state, end: options.end === true });

	/** The description of a flow controller, or `undefined` for another class. */
	export const describe = (controller: Function): FlowDescription | undefined =>
		Metadata.get(DESCRIPTION, controller);
}
