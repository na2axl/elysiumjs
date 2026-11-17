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

import type { Application } from '@elysiumjs/olympus';
import type {
	StepContext,
	StepOptions,
	WaitForOptions,
	WorkflowDefinition,
	WorkflowDuration,
	WorkflowStep
} from '@elysiumjs/olympus/odysseus';
import type { WorkersExecutionContext } from '../types.js';
import type { CloudflareStepLike, WorkflowRunnerPayload } from './types.js';

import { ElysiumError } from '@elysiumjs/olympus';
import {
	assertRetries,
	decodeValue,
	DEFAULT_RETRIES,
	DEFAULT_STEP_TIMEOUT,
	DEFAULT_WAIT_TIMEOUT,
	encodeValue,
	InvalidWorkflowStepError,
	MAX_WAIT_MS,
	toMilliseconds,
	UnregisteredWorkflowError,
	WorkflowRegistry,
	WorkflowStepFailedError,
	WorkflowTimeoutError
} from '@elysiumjs/olympus/odysseus';

import { runInvocation } from '../invocation.js';

/** Thrown when a workflow runs in an isolate whose Worker entry was not built with `createWorker()`. */
export class WorkflowApplicationMissingError extends ElysiumError {
	constructor() {
		super(
			'No application runs workflows in this Worker: build the Worker entry with createWorker(), and export WorkflowRunner from it.'
		);
	}
}

let application: Application | undefined;

/**
 * Hands the application to the workflow runner. `createWorker()` calls it.
 * @param app The application of the Worker.
 */
export const useWorkflowApplication = (app: Application): void => {
	application = app;
};

/** A signal that never aborts: Cloudflare stops a step that runs past its timeout itself. */
const quiet = (): AbortSignal => new AbortController().signal;

/** The milliseconds of a sleep or a wait, checked against the longest one. */
const waitMs = (duration: WorkflowDuration, what: string): number => {
	const ms = toMilliseconds(duration);
	if (ms > MAX_WAIT_MS)
		throw new InvalidWorkflowStepError(`${what} cannot be longer than 365 days.`);
	return ms;
};

/**
 * The steps of the port, over the steps of Cloudflare Workflows: values cross as JSON, a
 * DomainError returned by a step keeps its class, a step that fails for good throws
 * `WorkflowStepFailedError`, and a wait that times out gives `WorkflowTimeoutError`.
 * @param step The steps Cloudflare gives `run()`.
 * @param definition The definition of the workflow.
 */
export const adaptSteps = (
	step: CloudflareStepLike,
	definition: WorkflowDefinition
): WorkflowStep => {
	const decode = (value: unknown) => decodeValue(value, definition.known);
	return {
		do: async <T>(
			name: string,
			second: StepOptions | ((context: StepContext) => T | Promise<T>),
			third?: (context: StepContext) => T | Promise<T>
		) => {
			const options = typeof second === 'function' ? {} : second;
			const work = typeof second === 'function' ? second : third;
			if (typeof work !== 'function') {
				throw new InvalidWorkflowStepError('step.do() needs the work of the step as a function.');
			}
			const retries = options.retries ?? definition.retries ?? DEFAULT_RETRIES;
			assertRetries(retries);
			const config = {
				retries: {
					limit: retries.limit,
					delay: toMilliseconds(retries.delay),
					backoff: retries.backoff ?? 'exponential'
				},
				timeout: toMilliseconds(options.timeout ?? definition.timeout ?? DEFAULT_STEP_TIMEOUT)
			};
			let encoded: unknown;
			try {
				encoded = await step.do(name, config, async ({ attempt }) =>
					encodeValue(await work({ attempt, signal: quiet() }))
				);
			} catch (error) {
				throw new WorkflowStepFailedError(
					name,
					retries.limit + 1,
					error instanceof Error ? error.message : String(error)
				);
			}
			return decode(encoded) as T;
		},
		sleep: async (name: string, duration: WorkflowDuration) =>
			step.sleep(name, waitMs(duration, 'A sleep')),
		sleepUntil: async (name: string, until: Date | number | string) => {
			const at = new Date(until).getTime();
			if (Number.isNaN(at)) {
				throw new InvalidWorkflowStepError(`The time step "${name}" sleeps until is not a date.`);
			}
			return step.sleepUntil(name, at);
		},
		waitFor: async (name: string, event: { type: string }, options: WaitForOptions = {}) => {
			const timeout = waitMs(options.timeout ?? DEFAULT_WAIT_TIMEOUT, 'A wait');
			try {
				const received = await step.waitForEvent(name, { type: event.type, timeout });
				return decode(received.payload);
			} catch {
				// Cloudflare throws when the wait times out; the port gives the timeout as a value.
				return new WorkflowTimeoutError(name, event.type);
			}
		}
	} as WorkflowStep;
};

/**
 * Runs one instance of a workflow for `WorkflowRunner`: boots the application, then runs `run()`
 * of the workflow named in the payload, in its module and a request scope of its own, and
 * answers its encoded value.
 * @param env The env of the Workflow.
 * @param ctx The execution context of the Workflow.
 * @param payload What the instance was created with.
 * @param step The steps Cloudflare gives `run()`.
 */
export const runWorkflow = (
	env: Record<string, unknown>,
	ctx: WorkersExecutionContext,
	payload: WorkflowRunnerPayload,
	step: CloudflareStepLike
): Promise<unknown> =>
	runInvocation({ env, ctx }, async () => {
		if (!application) throw new WorkflowApplicationMissingError();
		await application.boot();
		const host = WorkflowRegistry.host;
		const definition = host.definition(payload.workflow);
		if (!definition) throw new UnregisteredWorkflowError(payload.workflow);
		const scope = {};
		try {
			return encodeValue(
				await host.run(payload.workflow, payload.params, adaptSteps(step, definition), scope)
			);
		} finally {
			await host.release(scope);
		}
	});
