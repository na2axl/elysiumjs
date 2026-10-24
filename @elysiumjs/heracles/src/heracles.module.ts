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

import type { Kernel } from '@elysiumjs/core';
import type { Job, JobClass } from './job';
import type { QueueOptions } from './queue';
import type { JobRegistryEntry } from './registry';

import { ElysiumError, KERNEL_SERVICE, Module, runAll, Service } from '@elysiumjs/core';

import { HeraclesCleanCommand, HeraclesListCommand, HeraclesWorkCommand } from './commands';
import { Queue } from './queue';
import { DuplicateJobError, JobRegistry, QUEUES_SERVICE } from './registry';
import { getJobMetadata } from './utils';

/**
 * Configuration of the {@link HeraclesModule}.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type HeraclesModuleConfig = {
	/** The queues to create, by name. */
	queues?: Record<string, Omit<QueueOptions, 'name'>>;
};

/**
 * The queues created from the module configuration. Built on first use; stops and removes
 * the queues it created when the app shuts down.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class ConfiguredQueues {
	public readonly queues: readonly Queue[];

	constructor(config: NonNullable<HeraclesModuleConfig['queues']>) {
		this.queues = Object.entries(config).map(([name, options]) => Queue.get(name, options));
	}

	public async onDestroy(): Promise<void> {
		await runAll(
			this.queues.map((queue) => async () => {
				try {
					await queue.stop();
				} finally {
					Queue.remove(queue.name);
				}
			})
		);
	}
}

/**
 * Collects the jobs that loaded modules declare in their `jobs` lists, runs each job inside
 * its owning module's context, and provides the Heracles commands.
 * @author Axel Nana <axel.nana@workbud.com>
 */
@Module.register<HeraclesModuleConfig>({
	commands: [HeraclesCleanCommand, HeraclesListCommand, HeraclesWorkCommand],
	services: (config) => [
		{ name: QUEUES_SERVICE, global: true, factory: () => new ConfiguredQueues(config.queues ?? {}) }
	]
})
export class HeraclesModule extends Module.configurable<HeraclesModuleConfig>({
	defaults: { queues: {} }
}) {
	/** Builds the job registry. Queues are created by the {@link ConfiguredQueues} service. */
	public override onInit(): void {
		const entries = new Map<string, JobRegistryEntry>();
		const kernel = Service.get<Kernel>(KERNEL_SERVICE);
		if (!kernel) {
			throw new ElysiumError(
				`HeraclesModule needs the "${KERNEL_SERVICE}" service, which the kernel registers when it boots.`
			);
		}

		for (const { item, module } of kernel.graph.collect('jobs')) {
			const jobClass = item as JobClass<Job>;
			const metadata = getJobMetadata(jobClass);
			if (!metadata) continue;
			const existing = entries.get(metadata.name);
			if (existing) {
				throw new DuplicateJobError(metadata.name, [existing.module.id, module.id]);
			}
			entries.set(metadata.name, { jobClass, module });
		}

		JobRegistry.set(entries);
	}

	/** Clears the module-level job registry. */
	public override onDestroy(): void {
		JobRegistry.clear();
	}
}
