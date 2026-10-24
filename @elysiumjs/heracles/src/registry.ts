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

import type { ModuleNode } from '@elysiumjs/core';
import type { Job, JobClass } from './job';

import { ElysiumError } from '@elysiumjs/core';

/**
 * Thrown when two modules declare jobs with the same name.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class DuplicateJobError extends ElysiumError {
	constructor(
		public readonly job: string,
		public readonly modules: [string, string]
	) {
		super(`Job "${job}" is declared by both ${modules[0]} and ${modules[1]}.`);
	}
}

/**
 * A job class with the module that declares it.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type JobRegistryEntry = { jobClass: JobClass<Job>; module: ModuleNode };

let entries = new Map<string, JobRegistryEntry>();

/**
 * The jobs declared by the loaded modules, keyed by job service name. Filled by
 * `HeraclesModule` on init and cleared on destroy.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export namespace JobRegistry {
	/** Replaces the registry contents. */
	export const set = (next: Iterable<readonly [string, JobRegistryEntry]>): void => {
		entries = new Map(next);
	};

	/** Finds a job by its service name. */
	export const get = (name: string): JobRegistryEntry | undefined => entries.get(name);

	/** Lists every registered job with its name. */
	export const all = (): readonly (JobRegistryEntry & { name: string })[] =>
		[...entries].map(([name, entry]) => ({ name, ...entry }));

	/** Empties the registry. */
	export const clear = (): void => {
		entries = new Map();
	};
}
