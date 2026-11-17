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

import type { WorkflowDuration } from './duration.js';
import type { WorkflowTimeoutError } from './errors.js';
import type { WorkflowEvent, WorkflowEventPayload } from './event.js';

import { toMilliseconds } from './duration.js';
import { InvalidWorkflowStepError } from './errors.js';

/**
 * How the delay between two attempts of a step grows: the same each time, by the delay each
 * time, or doubled each time.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type StepBackoff = 'constant' | 'linear' | 'exponential';

/**
 * How a step that throws is tried again.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type StepRetries = {
	/** How many times to try again after the first attempt. 0 tries once. */
	readonly limit: number;
	/** The delay before the first retry. */
	readonly delay: WorkflowDuration;
	/** How the delay grows. Defaults to `exponential`. */
	readonly backoff?: StepBackoff;
};

/**
 * The options of `step.do()`.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type StepOptions = {
	/** How a step that throws is tried again. Defaults to the workflow's, else 5 retries from 10 seconds, doubled each time. */
	readonly retries?: StepRetries;
	/**
	 * How long one attempt may run before it counts as failed. Defaults to the workflow's, else
	 * 10 minutes. The attempt is not stopped: its `signal` is aborted, and its result is ignored.
	 */
	readonly timeout?: WorkflowDuration;
};

/**
 * What the function of a step is given.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type StepContext = {
	/** The attempt, from 1. */
	readonly attempt: number;
	/** Aborted when the attempt runs past its timeout. */
	readonly signal: AbortSignal;
};

/**
 * The options of `step.waitFor()`.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type WaitForOptions = {
	/** How long to wait, from 1 second to 365 days. Defaults to 24 hours. */
	readonly timeout?: WorkflowDuration;
};

/**
 * The steps of a workflow, given to `run()`. Each step has a name, unique in its workflow or
 * repeated in a loop: a step name used several times in one run names a new step each time. A
 * finished step keeps its result, and gives it again, without running, when the workflow is
 * replayed.
 *
 * A step's value comes back as JSON: dates as ISO strings, class instances as plain objects.
 * A DomainError is kept with its class (see the `errors` of `@Workflow.register()`).
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export interface WorkflowStep {
	/**
	 * Runs a piece of work once. When it throws, it is tried again by its retries, then
	 * {@link WorkflowStepFailedError} is thrown into `run()`. When it returns a DomainError, it is
	 * not tried again: the error is its result, as a value.
	 * @param name The name of the step.
	 * @param work The work. Its value must be JSON.
	 */
	do<T>(name: string, work: (context: StepContext) => T | Promise<T>): Promise<T>;
	/**
	 * Runs a piece of work once, with its own retries or timeout.
	 * @param name The name of the step.
	 * @param options The retries and the timeout.
	 * @param work The work. Its value must be JSON.
	 */
	do<T>(
		name: string,
		options: StepOptions,
		work: (context: StepContext) => T | Promise<T>
	): Promise<T>;

	/**
	 * Waits for a duration, up to 365 days. The instance holds no worker while it waits.
	 * @param name The name of the step.
	 * @param duration How long.
	 */
	sleep(name: string, duration: WorkflowDuration): Promise<void>;

	/**
	 * Waits until a time, up to 365 days from now. A time already past goes on at once.
	 * @param name The name of the step.
	 * @param until The time.
	 */
	sleepUntil(name: string, until: Date | number | string): Promise<void>;

	/**
	 * Waits for an event sent with `Odysseus.signal()`. An event sent before the workflow reached
	 * this step is kept and taken here. Events of one type are taken in the order they came.
	 * @param name The name of the step.
	 * @param event The event.
	 * @param options How long to wait.
	 * @returns The payload, or a {@link WorkflowTimeoutError} when it did not come in time.
	 */
	waitFor<E extends WorkflowEvent>(
		name: string,
		event: E,
		options?: WaitForOptions
	): Promise<WorkflowEventPayload<E> | WorkflowTimeoutError>;
}

/** The retries of a step by default: 5 retries from 10 seconds, doubled each time. */
export const DEFAULT_RETRIES: StepRetries = {
	limit: 5,
	delay: '10 seconds',
	backoff: 'exponential'
};

/** How long one attempt of a step may run by default. */
export const DEFAULT_STEP_TIMEOUT: WorkflowDuration = '10 minutes';

/** How long `waitFor` waits by default. */
export const DEFAULT_WAIT_TIMEOUT: WorkflowDuration = '24 hours';

/** The longest sleep or wait: the limit of Cloudflare Workflows, so that a workflow runs on every driver. */
export const MAX_WAIT_MS = 365 * 86_400_000;

/**
 * The delay before an attempt of a step, from its retries.
 * @param retries The retries.
 * @param retry The retry, from 1.
 */
export const retryDelay = (retries: StepRetries, retry: number): number => {
	const delay = toMilliseconds(retries.delay);
	switch (retries.backoff ?? 'exponential') {
		case 'constant':
			return delay;
		case 'linear':
			return delay * retry;
		case 'exponential':
			return delay * 2 ** (retry - 1);
	}
};

/** Checks a step name. */
export const assertStepName = (name: string): void => {
	if (typeof name !== 'string' || name.length === 0 || name.length > 256) {
		throw new InvalidWorkflowStepError('A step needs a name of 1 to 256 characters.');
	}
};

/** Reads the arguments of `step.do()`. */
export const doArguments = <T>(
	second: StepOptions | ((context: StepContext) => T | Promise<T>),
	third?: (context: StepContext) => T | Promise<T>
): { options: StepOptions; work: (context: StepContext) => T | Promise<T> } => {
	if (typeof second === 'function') return { options: {}, work: second };
	if (typeof third !== 'function') {
		throw new InvalidWorkflowStepError('step.do() needs the work of the step as a function.');
	}
	return { options: second, work: third };
};

/** The milliseconds of a sleep or a wait, checked against the longest one. */
export const waitMilliseconds = (duration: WorkflowDuration, what: string): number => {
	const ms = toMilliseconds(duration);
	if (ms > MAX_WAIT_MS) {
		throw new InvalidWorkflowStepError(`${what} cannot be longer than 365 days.`);
	}
	return ms;
};
