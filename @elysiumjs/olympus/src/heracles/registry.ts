// Copyright (c) 2025-present Axel Nana <ax.lnana@outlook.com>. All rights reserved.
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

import type { Kernel, ModuleNode } from '../index';
import type { Job, JobClass } from './job';

import { ElysiumError, KERNEL_SERVICE, Service } from '../index';
import { getJobMetadata } from './utils';

/**
 * Thrown when two modules declare jobs with the same name.
 * @author Axel Nana <ax.lnana@outlook.com>
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
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type JobRegistryEntry = { jobClass: JobClass<Job>; module: ModuleNode };

/** The name of the global service that creates the configured queues. */
export const QUEUES_SERVICE = 'heracles.queues';

/** Name of the global service holding the lock of `HeraclesModule.with({ lock })`. */
export const HERACLES_LOCK = 'heracles.lock';

let entries = new Map<string, JobRegistryEntry>();

/**
 * The jobs declared by the loaded modules, keyed by job service name. Filled by
 * `HeraclesModule` on init and cleared on destroy.
 * @author Axel Nana <ax.lnana@outlook.com>
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

	/**
	 * Reads the jobs the modules of the application declare, from its module graph, without
	 * initialising the modules.
	 * @throws {ElysiumError} When the kernel is not registered.
	 * @throws {DuplicateJobError} When two modules declare jobs with the same name.
	 */
	export const collect = (): Map<string, JobRegistryEntry> => {
		const kernel = Service.get<Kernel>(KERNEL_SERVICE);
		if (!kernel) {
			throw new ElysiumError(
				`Heracles needs the "${KERNEL_SERVICE}" service, which the kernel registers when it boots.`
			);
		}

		const found = new Map<string, JobRegistryEntry>();
		for (const { item, module } of kernel.graph.collect('jobs')) {
			const jobClass = item as JobClass<Job>;
			const metadata = getJobMetadata(jobClass);
			if (!metadata) continue;
			const existing = found.get(metadata.name);
			if (existing) {
				throw new DuplicateJobError(metadata.name, [existing.module.id, module.id]);
			}
			found.set(metadata.name, { jobClass, module });
		}
		return found;
	};

	/** Empties the registry. */
	export const clear = (): void => {
		entries = new Map();
	};
}
