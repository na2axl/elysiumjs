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

import type { StoredError } from './serialize.js';
import type { WorkflowStep } from './step.js';
import type { WorkflowDefinition } from './workflow.js';

import { Port } from '../port.js';

/**
 * Where an instance stands.
 *
 * - `queued`: started, not run yet.
 * - `running`: a worker runs it now.
 * - `waiting`: asleep, waiting for an event, or waiting to retry a step.
 * - `paused`: paused by the driver's own tools.
 * - `completed`: `run()` returned; `output` holds its value.
 * - `errored`: `run()` threw; `error` says why.
 * - `terminated`: stopped with `Odysseus.terminate()`.
 * - `unknown`: the driver cannot tell.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type WorkflowStatus =
	'queued' | 'running' | 'waiting' | 'paused' | 'completed' | 'errored' | 'terminated' | 'unknown';

/** The statuses of a finished instance, which takes no more events. */
export const FINISHED_STATUSES: readonly WorkflowStatus[] = ['completed', 'errored', 'terminated'];

/**
 * An instance to start.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type WorkflowStartRequest = {
	/** The name of the workflow. */
	readonly workflow: string;
	/** The id of the instance, unique in its workflow. */
	readonly id: string;
	/** The params `run()` is given, as JSON. */
	readonly params: unknown;
};

/**
 * What a driver knows about an instance.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type WorkflowDriverState = {
	readonly status: WorkflowStatus;
	/** The value `run()` returned, encoded (see `encodeValue`). */
	readonly output?: unknown;
	/** What `run()` threw. */
	readonly error?: StoredError;
	readonly createdAt?: Date;
	readonly updatedAt?: Date;
};

/**
 * What a driver answers when it is sent an event.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type WorkflowSignalOutcome = 'sent' | 'missing' | 'finished';

/**
 * Runs the workflows of the application, for the driver: the driver calls `run` with its own
 * step implementation whenever an instance runs.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export interface WorkflowHost {
	/**
	 * Runs `run()` of a workflow in its module, in the request scope of `scope`. A run that
	 * suspends never settles, so the driver ends the scope with {@link release} once it is done
	 * with the run.
	 * @param workflow The name of the workflow.
	 * @param params The params of the instance.
	 * @param step The steps.
	 * @param scope The object the request scope of the run belongs to.
	 */
	run(workflow: string, params: unknown, step: WorkflowStep, scope: object): Promise<unknown>;

	/** Ends the request scope of a run, calling `onDestroy` on its request-scoped services. */
	release(scope: object): Promise<void>;

	/** The definition of a registered workflow, or `undefined`. */
	definition(workflow: string): WorkflowDefinition | undefined;

	/** The names of the registered workflows. */
	workflows(): string[];
}

/**
 * Starts, runs and stops workflow instances. `engine` is built in and runs them in the process,
 * over a {@link WorkflowStore}; `@elysiumjs/workers` provides `cloudflare`, over Cloudflare
 * Workflows.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export interface WorkflowDriver {
	/**
	 * Starts instances. An instance whose id exists already is left as it is.
	 * @returns For each request, whether it started a new instance.
	 */
	start(requests: readonly WorkflowStartRequest[]): Promise<boolean[]>;

	/** Sends an event to an instance. */
	signal(
		workflow: string,
		id: string,
		type: string,
		payload: unknown
	): Promise<WorkflowSignalOutcome>;

	/** What the driver knows about an instance, or `null` when it has none with this id. */
	status(workflow: string, id: string): Promise<WorkflowDriverState | null>;

	/** Stops an instance. Answers `false` when it is missing or finished already. */
	terminate(workflow: string, id: string): Promise<boolean>;

	/** Called when `OdysseusModule` starts, with the host that runs the workflows. */
	open?(host: WorkflowHost): void | Promise<void>;

	/** Called when `OdysseusModule` stops. */
	close?(): void | Promise<void>;
}

declare module '../port.js' {
	interface Ports {
		workflow: WorkflowDriver;
	}
}

/**
 * The workflow driver port. Pick a driver with `Workflows.for(name, options)`: `engine` here,
 * `cloudflare` from `@elysiumjs/workers`.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @example
 * ```ts
 * OdysseusModule.with({
 * 	driver: () => Workflows.for('engine', { store: WorkflowStore.for('memory') })
 * });
 * ```
 */
export class Workflows extends Port('workflow') {}
