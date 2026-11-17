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

import { AsyncLocalStorage } from 'node:async_hooks';

import { ElysiumError } from '@elysiumjs/olympus';
import {
	assertRetries,
	assertStepName,
	DEFAULT_RETRIES,
	DEFAULT_STEP_TIMEOUT,
	DEFAULT_WAIT_TIMEOUT,
	doArguments,
	InvalidWorkflowStepError,
	keepValue,
	MAX_WAIT_MS,
	restoreValue,
	toMilliseconds,
	UnregisteredWorkflowError,
	waitMilliseconds,
	WorkflowRegistry,
	WorkflowStepFailedError,
	WorkflowTimeoutError
} from '@elysiumjs/olympus/odysseus';

import { runInvocation } from '../invocation.js';

/** Thrown when an instance of the runner was not created by the `cloudflare` driver. */
export class WorkflowPayloadError extends ElysiumError {
	constructor() {
		super(
			'This Workflow instance was not started by Odysseus: start instances with Odysseus.start(), not from the dashboard or the REST API.'
		);
	}
}

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

/** The shortest wait Cloudflare takes. */
const MIN_WAIT_MS = 1000;

/** What a step answers when its value cannot be kept: the step fails without a retry. */
type Unkept = { '~unkept': string };

const isUnkept = (value: unknown): value is Unkept =>
	typeof value === 'object' &&
	value !== null &&
	Object.keys(value).length === 1 &&
	typeof (value as Unkept)['~unkept'] === 'string';

/** Runs a function in the async context of the caller, whatever context Cloudflare calls it in. */
const inContext = (): (<T>(fn: () => T) => T) =>
	(AsyncLocalStorage as { snapshot?: () => <T>(fn: () => T) => T }).snapshot?.() ?? ((fn) => fn());

const messageOf = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

/**
 * The steps of the port, over the steps of Cloudflare Workflows: values are kept with `Json`, so
 * a serializable DomainError returned by a step keeps its class, a step that fails for good throws
 * `WorkflowStepFailedError`, and a wait that times out gives `WorkflowTimeoutError`.
 * @param step The steps Cloudflare gives `run()`.
 * @param definition The definition of the workflow.
 */
export const adaptSteps = (
	step: CloudflareStepLike,
	definition: WorkflowDefinition
): WorkflowStep => {
	const decode = (value: unknown) => restoreValue(value);
	return {
		do: async <T>(
			name: string,
			second: StepOptions | ((context: StepContext) => T | Promise<T>),
			third?: (context: StepContext) => T | Promise<T>
		) => {
			assertStepName(name);
			const { options, work } = doArguments(second, third);
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
			const run = inContext();
			// What the last attempt of this run did, to tell a failure of the work from one of Cloudflare.
			let last: { attempt: number; error?: unknown } | undefined;
			let encoded: unknown;
			try {
				encoded = await step.do(name, config, ({ attempt }) =>
					run(async () => {
						last = { attempt };
						let value: unknown;
						try {
							value = await work({ attempt, signal: AbortSignal.timeout(config.timeout) });
						} catch (error) {
							last = { attempt, error };
							throw error;
						}
						try {
							return keepValue(value);
						} catch (error) {
							return { '~unkept': `returned a value that cannot be kept: ${messageOf(error)}` };
						}
					})
				);
			} catch (error) {
				// A failure the work threw, live or kept by Cloudflare, ends the step; any other one,
				// such as a limit of Cloudflare, is not a failure of the step and goes on as it is.
				if (last && !('error' in last)) throw error;
				throw new WorkflowStepFailedError(
					name,
					last?.attempt ?? retries.limit + 1,
					messageOf(last && 'error' in last ? last.error : error)
				);
			}
			if (isUnkept(encoded)) {
				throw new WorkflowStepFailedError(name, last?.attempt ?? 1, encoded['~unkept']);
			}
			return decode(encoded) as T;
		},
		sleep: async (name: string, duration: WorkflowDuration) => {
			assertStepName(name);
			return step.sleep(name, waitMilliseconds(duration, 'A sleep'));
		},
		sleepUntil: async (name: string, until: Date | number | string) => {
			assertStepName(name);
			const at = new Date(until).getTime();
			if (Number.isNaN(at)) {
				throw new InvalidWorkflowStepError(`The time step "${name}" sleeps until is not a date.`);
			}
			if (at - Date.now() > MAX_WAIT_MS) {
				throw new InvalidWorkflowStepError('A sleep cannot be longer than 365 days.');
			}
			return step.sleepUntil(name, at);
		},
		waitFor: async (name: string, event: { type: string }, options: WaitForOptions = {}) => {
			assertStepName(name);
			// Cloudflare waits 1 second at the least.
			const timeout = Math.max(
				waitMilliseconds(options.timeout ?? DEFAULT_WAIT_TIMEOUT, 'A wait'),
				MIN_WAIT_MS
			);
			let received: { payload: unknown };
			try {
				received = await step.waitForEvent(name, { type: event.type, timeout });
			} catch {
				// Cloudflare throws when the wait times out; the port gives the timeout as a value.
				return new WorkflowTimeoutError(name, event.type);
			}
			return decode(received.payload);
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
		if (typeof payload !== 'object' || payload === null || typeof payload.workflow !== 'string') {
			throw new WorkflowPayloadError();
		}
		await application.boot();
		const host = WorkflowRegistry.host;
		const definition = host.definition(payload.workflow);
		if (!definition) throw new UnregisteredWorkflowError(payload.workflow);
		const scope = {};
		try {
			return keepValue(
				await host.run(payload.workflow, payload.params, adaptSteps(step, definition), scope)
			);
		} finally {
			await host.release(scope);
		}
	});
