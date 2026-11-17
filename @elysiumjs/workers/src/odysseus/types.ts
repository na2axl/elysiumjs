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

/**
 * The slice of a Cloudflare Workflow binding the `cloudflare` driver uses: a `workflows` binding
 * of the wrangler config, or `ctx.exports.<Class>`.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export interface WorkflowBindingLike {
	createBatch(options: { instances: { id: string; params?: unknown }[] }): Promise<{
		created: { id: string }[];
		errors: { index: number; id?: string; code: number; message: string }[];
	}>;
	get(id: string): Promise<WorkflowInstanceLike>;
}

/**
 * The slice of a Cloudflare Workflow instance the `cloudflare` driver uses.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export interface WorkflowInstanceLike {
	readonly id: string;
	status(): Promise<{
		status:
			| 'queued'
			| 'running'
			| 'paused'
			| 'errored'
			| 'terminated'
			| 'complete'
			| 'waiting'
			| 'waitingForPause'
			| 'unknown';
		error?: { name: string; message: string } | null;
		output?: unknown;
	}>;
	sendEvent(event: { type: string; payload: unknown }): Promise<void>;
	terminate(): Promise<void>;
}

/** A step config of Cloudflare Workflows. */
export type CloudflareStepConfig = {
	retries?: { limit: number; delay: number; backoff?: 'constant' | 'linear' | 'exponential' };
	timeout?: number;
};

/**
 * The slice of the `step` that Cloudflare Workflows gives `run()`, which the runner adapts.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export interface CloudflareStepLike {
	do<T>(
		name: string,
		config: CloudflareStepConfig,
		callback: (ctx: { attempt: number }) => Promise<T>
	): Promise<T>;
	sleep(name: string, duration: number): Promise<void>;
	sleepUntil(name: string, timestamp: Date | number): Promise<void>;
	waitForEvent<T>(
		name: string,
		options: { type: string; timeout?: number }
	): Promise<{ payload: T; timestamp: Date; type: string }>;
}

/**
 * What a Cloudflare Workflow instance of the `cloudflare` driver is created with: the workflow
 * to run, and its params.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type WorkflowRunnerPayload = { readonly workflow: string; readonly params: unknown };
