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
 * Raised when a flow is declared wrong: no steps, a name that is not kebab-case, a TTL that is
 * not positive, or an unknown step in `start` or `back`.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class InvalidFlowError extends ElysiumError {
	constructor(flow: string, reason: string) {
		super(`Flow "${flow}" ${reason}.`);
	}
}

/**
 * The flow does not exist, or it expired: a 410 problem.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class FlowExpiredError extends DomainError {
	constructor() {
		super({ status: 410, type: 'flow-expired', detail: 'This flow has expired. Start it again.' });
	}
}

/**
 * The flow is finished: a 410 problem.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class FlowCompletedError extends DomainError {
	constructor() {
		super({ status: 410, type: 'flow-completed', detail: 'This flow is already finished.' });
	}
}

/**
 * The step is not one the flow accepts now: a 409 problem that lists the next and back steps,
 * and the last answer.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class FlowUnexpectedStepError extends DomainError {
	constructor(step: string, position: { next: string[]; back: string[] }, answer: unknown) {
		super({
			status: 409,
			type: 'flow-unexpected-step',
			detail: `The step "${step}" is not allowed now.`,
			extensions: { nextSteps: position.next, backSteps: position.back, answer }
		});
	}
}

/**
 * Another request is running the same step: a 409 problem. Retry shortly.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class FlowStepInProgressError extends DomainError {
	constructor() {
		super({
			status: 409,
			type: 'flow-step-in-progress',
			detail: 'This step is already being processed. Retry shortly.'
		});
	}
}

/**
 * The caller does not own the flow: a 403 problem.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class FlowForbiddenError extends DomainError {
	constructor() {
		super({ status: 403, detail: 'This flow belongs to someone else.' });
	}
}

/**
 * A user flow called without a signed-in user: a 401 problem.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class FlowUserRequiredError extends DomainError {
	constructor() {
		super({ status: 401, detail: 'Sign in to use this flow.' });
	}
}

/**
 * The body of a step does not match its schema, or misses `flowKey` or `stepId`: a 422 problem
 * with one entry per mistake.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class InvalidFlowBodyError extends DomainError {
	constructor(errors: ProblemValidationError[]) {
		super({ status: 422, detail: 'The request body is invalid.', extensions: { errors } });
	}
}
