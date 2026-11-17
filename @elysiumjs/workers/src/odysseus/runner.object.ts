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

import type { WorkersExecutionContext } from '../types.js';
import type { CloudflareStepLike, WorkflowRunnerPayload } from './types.js';

import { WorkflowEntrypoint } from 'cloudflare:workers';

import { runWorkflow } from './runner.js';

/**
 * The Workflow class of the `cloudflare` workflow driver: one class runs every workflow of the
 * application, named in the params of each instance. Export it from the Worker entry, built
 * with `createWorker()`, and declare it as the class of the `WORKFLOWS` binding, and of the
 * bindings that workflows take for their own.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @example
 * ```ts
 * // worker.ts
 * export { WorkflowRunner } from '@elysiumjs/workers/durable-objects';
 * ```
 * ```jsonc
 * // wrangler.jsonc
 * "workflows": [{ "name": "my-app-workflows", "binding": "WORKFLOWS", "class_name": "WorkflowRunner" }]
 * ```
 */
export class WorkflowRunner extends WorkflowEntrypoint<
	Record<string, unknown>,
	WorkflowRunnerPayload
> {
	public run(
		event: { payload: WorkflowRunnerPayload },
		step: CloudflareStepLike
	): Promise<unknown> {
		return runWorkflow(this.env, this.ctx as WorkersExecutionContext, event.payload, step);
	}
}
