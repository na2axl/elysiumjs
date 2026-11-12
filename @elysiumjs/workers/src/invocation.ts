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

import type { WorkersExecutionContext } from './types';

import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * What a Worker invocation (a request, a queue batch or a scheduled event) was called with.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type Invocation = {
	/** The Worker's bindings, vars and secrets. */
	readonly env: Record<string, unknown>;
	/** The execution context of the invocation. */
	readonly ctx: WorkersExecutionContext;
};

const storage = new AsyncLocalStorage<Invocation>();

/**
 * Runs `fn` as part of an invocation, so that its bindings resolve inside it.
 * @param invocation The env and context of the invocation.
 * @param fn The work to run.
 */
export const runInvocation = <T>(invocation: Invocation, fn: () => T): T =>
	storage.run(invocation, fn);

/** The current invocation, if any. */
export const currentInvocation = (): Invocation | undefined => storage.getStore();
