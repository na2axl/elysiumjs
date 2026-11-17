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

import { DomainError, ElysiumError } from '../index.js';

/**
 * Raised when a workflow is declared wrong: no name, a name already taken, or no `run` method.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class InvalidWorkflowError extends ElysiumError {
	constructor(workflow: string, reason: string) {
		super(`Workflow "${workflow}" ${reason}.`);
	}
}

/**
 * Raised when two modules declare workflows with the same name.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class DuplicateWorkflowError extends ElysiumError {
	constructor(
		public readonly workflow: string,
		public readonly modules: [string, string]
	) {
		super(`Workflow "${workflow}" is declared by both ${modules[0]} and ${modules[1]}.`);
	}
}

/**
 * Raised when a workflow is used that no module of the application lists in its `workflows`.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class UnregisteredWorkflowError extends ElysiumError {
	constructor(workflow: string) {
		super(
			`Workflow "${workflow}" is not registered: list its class in the \`workflows\` of a module.`
		);
	}
}

/**
 * Raised when a workflow is started or reached outside an application that imports
 * `OdysseusModule`.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class OdysseusNotConfiguredError extends ElysiumError {
	constructor() {
		super('Workflows need OdysseusModule: add OdysseusModule.with({ driver }) to the application.');
	}
}

/**
 * Raised by a driver that cannot run where it is: the `engine` driver needs a long-lived process,
 * which a Cloudflare Worker is not.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class WorkflowDriverUnavailableError extends ElysiumError {
	constructor(driver: string, reason: string) {
		super(`The workflow driver "${driver}" cannot run here: ${reason}.`);
	}
}

/**
 * Raised when a step name is empty, or a duration cannot be read.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class InvalidWorkflowStepError extends ElysiumError {
	constructor(reason: string) {
		super(reason);
	}
}

/**
 * Thrown into `run()` when a step threw on every attempt its retries allowed. Uncaught, it ends
 * the instance as `errored`; caught, the workflow goes on. Replays throw it again without running
 * the step.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class WorkflowStepFailedError extends ElysiumError {
	constructor(
		public readonly step: string,
		public readonly attempts: number,
		/** The message of the last error the step threw. */
		public readonly reason: string
	) {
		super(`Step "${step}" failed after ${attempts} attempt(s): ${reason}`);
	}
}

/**
 * No workflow instance has this id: a 404 problem.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class WorkflowNotFoundError extends DomainError.for('WORKFLOW_NOT_FOUND', 404) {
	constructor(workflow: string, id: string) {
		super(`No instance of the workflow "${workflow}" has the id "${id}".`, {
			extensions: { workflow, id }
		});
	}
}

/**
 * A workflow instance with this id exists already: a 409 problem. Starting twice with the same
 * id starts it once.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class WorkflowAlreadyStartedError extends DomainError.for('WORKFLOW_ALREADY_STARTED', 409) {
	constructor(workflow: string, id: string) {
		super(`An instance of the workflow "${workflow}" has the id "${id}" already.`, {
			extensions: { workflow, id }
		});
	}
}

/**
 * The workflow instance is finished and takes no more events: a 409 problem.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class WorkflowFinishedError extends DomainError.for('WORKFLOW_FINISHED', 409) {
	constructor(workflow: string, id: string) {
		super(`The instance "${id}" of the workflow "${workflow}" is finished.`, {
			extensions: { workflow, id }
		});
	}
}

/**
 * What `step.waitFor()` gives when its event did not come in time: a 504 problem, returned as a
 * value, never thrown.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class WorkflowTimeoutError extends DomainError.for('WORKFLOW_TIMEOUT', 504) {
	constructor(step: string, event: string) {
		super(`The step "${step}" waited for "${event}" and it did not come in time.`, {
			extensions: { step, event }
		});
	}
}
