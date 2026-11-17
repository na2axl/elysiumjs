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
	WorkflowDriver,
	WorkflowDriverState,
	WorkflowHost,
	WorkflowSignalOutcome,
	WorkflowStartRequest,
	WorkflowStatus
} from '@elysiumjs/olympus/odysseus';
import type { WorkflowBindingLike, WorkflowInstanceLike, WorkflowRunnerPayload } from './types.js';

import { ElysiumError } from '@elysiumjs/olympus';
import { FINISHED_STATUSES, keepError, Workflows } from '@elysiumjs/olympus/odysseus';

import { Workers } from '../workers.js';

/**
 * Options of the `cloudflare` workflow driver.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type CloudflareWorkflowDriverOptions = {
	/**
	 * The Workflow binding the workflows share, declared with `WorkflowRunner` as its class.
	 * Defaults to `WORKFLOWS`. A workflow gets a binding of its own with
	 * `@Workflow.register({ driver: { binding: 'PAYOUTS' } })`.
	 */
	binding?: string;
};

declare module '@elysiumjs/olympus' {
	interface PortDrivers {
		'workflow:cloudflare': typeof CloudflareWorkflowDriver;
	}
}

/**
 * Thrown when Cloudflare refuses to create instances for another reason than an id in use, such
 * as a rate limit. The instances of the batches sent before it are created: `started` tells, for
 * each request, whether its instance started.
 */
export class WorkflowCreateError extends ElysiumError {
	constructor(
		workflow: string,
		reasons: string[],
		public readonly started: readonly boolean[]
	) {
		super(`Cloudflare Workflows could not start instances of "${workflow}": ${reasons.join('; ')}`);
	}
}

/** Thrown when two workflows would share the ids of one binding. */
export class WorkflowBindingConflictError extends ElysiumError {
	constructor(first: string, second: string, binding: string) {
		super(
			`The workflows "${first}" and "${second}" would share the instance ids of the Cloudflare binding "${binding}": give each workflow a binding of its own, or rename one of them.`
		);
	}
}

/** The codes `createBatch` answers for an id in use, or repeated in the batch. */
const ID_IN_USE = new Set([10405, 10415]);

/** The largest batch `createBatch` takes. */
const BATCH = 100;

/** A short, stable hash of a workflow name: 8 hexadecimal digits (FNV-1a, 32 bits). */
const hashOf = (name: string): string => {
	let hash = 0x811c9dc5;
	for (let i = 0; i < name.length; i++) {
		hash ^= name.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return hash.toString(16).padStart(8, '0');
};

/** The status of an instance, as the port names it. */
const statusOf = (status: string): WorkflowStatus => {
	switch (status) {
		case 'complete':
			return 'completed';
		case 'waitingForPause':
			return 'running';
		case 'queued':
		case 'running':
		case 'paused':
		case 'errored':
		case 'terminated':
		case 'waiting':
			return status;
		default:
			return 'unknown';
	}
};

/** Whether an error of `get()` says that the instance does not exist. */
const isMissing = (error: unknown): boolean =>
	/not[ _-]?found|does ?n[o']t exist|no such instance/i.test(
		error instanceof Error ? error.message : String(error)
	);

/**
 * Runs workflows on Cloudflare Workflows. Every workflow shares one binding by default
 * (`WORKFLOWS`), whose class is `WorkflowRunner` from `@elysiumjs/workers/durable-objects`; the
 * instance ids of a shared binding start with a hash of the workflow name, so that two workflows
 * may use the same id. A workflow may take a binding of its own (`driver: { binding }`), with
 * the same class, whose instance ids are the ids given to `Odysseus.start()`.
 *
 * Steps map to the steps of Cloudflare Workflows, with their names, retries and timeouts. The
 * Worker entry must be built with `createWorker()`, which hands the application to the runner.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @example
 * ```ts
 * OdysseusModule.with({ driver: () => Workflows.for('cloudflare') });
 *
 * // worker.ts
 * export { WorkflowRunner } from '@elysiumjs/workers/durable-objects';
 * ```
 */
@Workflows.driver('cloudflare')
export class CloudflareWorkflowDriver implements WorkflowDriver {
	#host: WorkflowHost | undefined;

	constructor(private readonly options: CloudflareWorkflowDriverOptions = {}) {}

	public open(host: WorkflowHost): void {
		this.#host = host;
		// A shared binding tells workflows apart by the hash of their names; a binding of its own
		// holds the ids of one workflow only, so no other workflow may use it.
		const shared = this.options.binding ?? 'WORKFLOWS';
		const keys = new Map<string, string>();
		const bindings = new Map<string, string>();
		for (const workflow of host.workflows()) {
			const own = this.#ownBinding(workflow);
			const binding = own ?? shared;
			const key = own === undefined ? `${shared}#${hashOf(workflow)}` : own;
			const other =
				keys.get(key) ?? (own !== undefined ? bindings.get(own) : bindings.get(`own:${shared}`));
			if (other !== undefined) throw new WorkflowBindingConflictError(other, workflow, binding);
			keys.set(key, workflow);
			bindings.set(own === undefined ? binding : `own:${own}`, workflow);
		}
	}

	public async start(requests: readonly WorkflowStartRequest[]): Promise<boolean[]> {
		const started = new Array<boolean>(requests.length).fill(false);
		const groups = new Map<string, number[]>();
		for (const [index, request] of requests.entries()) {
			const binding = this.#bindingName(request.workflow);
			groups.set(binding, [...(groups.get(binding) ?? []), index]);
		}
		for (const [binding, indexes] of groups) {
			for (let from = 0; from < indexes.length; from += BATCH) {
				const chunk = indexes.slice(from, from + BATCH);
				const instances = chunk.map((index) => {
					const { workflow, id, params } = requests[index]!;
					const payload: WorkflowRunnerPayload = { workflow, params };
					return { id: this.instanceId(workflow, id), params: payload };
				});
				let result: Awaited<ReturnType<WorkflowBindingLike['createBatch']>>;
				try {
					result = await Workers.binding<WorkflowBindingLike>(binding).createBatch({ instances });
				} catch (error) {
					throw new WorkflowCreateError(
						requests[chunk[0]!]!.workflow,
						[error instanceof Error ? error.message : String(error)],
						started
					);
				}
				const failed = new Set<number>();
				const reasons: string[] = [];
				for (const error of result.errors) {
					failed.add(error.index);
					if (!ID_IN_USE.has(error.code))
						reasons.push(`${error.id ?? error.index}: ${error.message}`);
				}
				chunk.forEach((index, i) => (started[index] = !failed.has(i)));
				if (reasons.length > 0) {
					throw new WorkflowCreateError(requests[chunk[0]!]!.workflow, reasons, started);
				}
			}
		}
		return started;
	}

	public async signal(
		workflow: string,
		id: string,
		type: string,
		payload: unknown
	): Promise<WorkflowSignalOutcome> {
		const instance = await this.#instance(workflow, id);
		if (!instance) return 'missing';
		if (await this.#finished(instance)) return 'finished';
		try {
			await instance.sendEvent({ type, payload });
			return 'sent';
		} catch (error) {
			// The instance may have ended between the two calls.
			if (await this.#finished(instance).catch(() => false)) return 'finished';
			throw error;
		}
	}

	public async status(workflow: string, id: string): Promise<WorkflowDriverState | null> {
		const instance = await this.#instance(workflow, id);
		if (!instance) return null;
		const state = await instance.status();
		return {
			status: statusOf(state.status),
			...(state.status === 'complete' && state.output !== undefined
				? { output: state.output }
				: {}),
			// Cloudflare keeps the name and message of what `run()` threw.
			...(state.error
				? {
						error: keepError(
							Object.assign(new Error(state.error.message), { name: state.error.name })
						)
					}
				: {})
		};
	}

	public async terminate(workflow: string, id: string): Promise<boolean> {
		const instance = await this.#instance(workflow, id);
		if (!instance) return false;
		if (await this.#finished(instance)) return false;
		try {
			await instance.terminate();
			return true;
		} catch (error) {
			if (await this.#finished(instance).catch(() => false)) return false;
			throw error;
		}
	}

	async #finished(instance: WorkflowInstanceLike): Promise<boolean> {
		return FINISHED_STATUSES.includes(statusOf((await instance.status()).status));
	}

	/**
	 * The id of an instance on Cloudflare: on the shared binding, a hash of the workflow name and
	 * the id; on a binding of its own, the id.
	 * @param workflow The name of the workflow.
	 * @param id The id given to `Odysseus.start()`.
	 */
	public instanceId(workflow: string, id: string): string {
		return this.#ownBinding(workflow) ? id : `${hashOf(workflow)}_${id}`;
	}

	/** The binding of a workflow named in its props, if any. */
	#ownBinding(workflow: string): string | undefined {
		const binding = this.#host?.definition(workflow)?.driver?.binding;
		return typeof binding === 'string' ? binding : undefined;
	}

	#bindingName(workflow: string): string {
		return this.#ownBinding(workflow) ?? this.options.binding ?? 'WORKFLOWS';
	}

	async #instance(workflow: string, id: string): Promise<WorkflowInstanceLike | null> {
		const binding = Workers.binding<WorkflowBindingLike>(this.#bindingName(workflow));
		try {
			return await binding.get(this.instanceId(workflow, id));
		} catch (error) {
			if (isMissing(error)) return null;
			throw error;
		}
	}
}
