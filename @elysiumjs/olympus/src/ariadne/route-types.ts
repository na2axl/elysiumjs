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

import type {
	DomainError,
	Failed,
	HttpRouteDescription,
	HttpRouteTypeRef,
	HttpRouteTypes,
	HttpRouteTypesContributor,
	Passed
} from '../index';
import type { FlowAdvance, FlowRefusal } from './flow';

import { Environments, Http, Service } from '../index';

import { Flow } from './flow';

/**
 * What `POST /flows/{flow}` answers: the key of the new flow, the owner token of a guest flow,
 * and the steps it may run first.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type FlowStart = {
	flowKey: string;
	owner?: string;
	nextSteps: string[];
	backSteps: string[];
};

/**
 * What `GET /flows/{flow}` answers: where the flow stands, and the last answer.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type FlowStatus = {
	flowKey: string;
	step: string | null;
	nextSteps: string[];
	backSteps: string[];
	answer: unknown;
};

/** What a step gives: the value of a passed `Result`, nothing for a failed one. */
type Given<R> = R extends Passed<infer T> ? T : R extends Failed<any> ? never : R;

/**
 * The answer of a step, from what its method returns: the `answer` of {@link Flow.advance}, or
 * the value it returns that keeps the state, or the value of a passed `Result`. A refusal, a
 * returned error and a failed `Result` are problems.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type FlowAnswer<R> =
	Exclude<Given<Awaited<R>>, FlowRefusal<any> | DomainError> extends infer V
		? V extends FlowAdvance<any, infer A>
			? A
			: V extends undefined | void
				? null
				: V
		: never;

/**
 * What `POST /flows/{flow}/{step}` answers, for a step method returning `R`.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type FlowStepReply<R> = {
	answer: FlowAnswer<R>;
	nextSteps: string[];
	backSteps: string[];
};

const types = (response: string, name: string): HttpRouteTypes => ({
	response,
	imports: [{ from: '@elysiumjs/olympus/ariadne', names: [name] }]
});

/**
 * Types the routes of flow controllers for `styx routes:generate`: the start and state routes
 * the flow adds, and the replies of its steps. Active in development only.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
@Service.register({ tags: [Http.RouteTypes], global: true, env: Environments.local })
export class FlowRouteTypes implements HttpRouteTypesContributor {
	public supports(controller: Function): boolean {
		return Flow.describe(controller) !== undefined;
	}

	public route(
		_controller: Function,
		route: HttpRouteDescription,
		ref: HttpRouteTypeRef
	): HttpRouteTypes | undefined {
		if (route.name === 'ariadne:start') return types('FlowStart', 'FlowStart');
		if (route.name === 'ariadne:state') return types('FlowStatus', 'FlowStatus');
		if (ref.method === undefined) return undefined;
		return types(`FlowStepReply<ReturnType<${ref.method}>>`, 'FlowStepReply');
	}
}
