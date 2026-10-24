// Copyright (c) 2025-present Workbud Technologies Inc. All rights reserved.
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

import type { ModuleNode } from './module-graph';

import { AsyncLocalStorage } from 'node:async_hooks';

const storage = new AsyncLocalStorage<ModuleNode>();

/**
 * Tracks which module is currently being booted or is serving a request,
 * so that service lookups can enforce module visibility.
 *
 * @author Axel Nana <axel.nana@workbud.com>
 */
export namespace ModuleContext {
	/**
	 * Runs `fn` with `node` as the current module. The context follows async continuations.
	 * @param node The module to make current.
	 * @param fn The function to run.
	 * @returns The value returned by `fn`.
	 */
	export function run<T>(node: ModuleNode, fn: () => T): T {
		return storage.run(node, fn);
	}

	/**
	 * Gets the module current in this async context, if any.
	 */
	export function current(): ModuleNode | undefined {
		return storage.getStore();
	}
}
