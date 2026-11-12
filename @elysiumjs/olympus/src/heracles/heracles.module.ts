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

import type { CipherDriver } from '../harpocrates/cipher';
import type { LockDriver, ServiceFactoryDefinition } from '../index';
import type { QueueOptions } from './queue';

import { Module, runAll } from '../index';
import { HeraclesCronsCommand, HeraclesListCommand, HeraclesScheduleCommand } from './commands';
import { Queue } from './queue';
import { HERACLES_CIPHER, HERACLES_LOCK, JobRegistry, QUEUES_SERVICE } from './registry';

/**
 * Configuration of the {@link HeraclesModule}.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type HeraclesModuleConfig = {
	/** The queues to create, by name. */
	queues?: Record<string, Omit<QueueOptions, 'name'>>;

	/**
	 * The lock each scheduler tick takes, so that several `heracles:schedule` processes dispatch
	 * each tick once, such as `Lock.for('redis')`. Without it, every scheduler dispatches every tick.
	 */
	lock?: LockDriver;

	/**
	 * The cipher of the jobs registered with `encrypted: true`, such as
	 * `Cipher.for('aes-gcm', { keys })` from `@elysiumjs/olympus/harpocrates`. Their arguments are
	 * encrypted before they reach the transport, and decrypted in the worker.
	 */
	cipher?: CipherDriver;
};

/**
 * The queues created from the module configuration. Built on first use; stops and removes
 * the queues it created when the app shuts down.
 * @author Axel Nana <ax.lnana@outlook.com>
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
 * @author Axel Nana <ax.lnana@outlook.com>
 */
@Module.register<HeraclesModuleConfig>({
	commands: [HeraclesCronsCommand, HeraclesListCommand, HeraclesScheduleCommand],
	services: (config) => {
		const services: ServiceFactoryDefinition[] = [
			{
				name: QUEUES_SERVICE,
				global: true,
				factory: () => new ConfiguredQueues(config.queues ?? {})
			}
		];
		const lock = config.lock;
		if (lock) services.push({ name: HERACLES_LOCK, global: true, factory: () => lock });
		const cipher = config.cipher;
		if (cipher) services.push({ name: HERACLES_CIPHER, global: true, factory: () => cipher });
		return services;
	}
})
export class HeraclesModule extends Module.configurable<HeraclesModuleConfig>({
	defaults: { queues: {} }
}) {
	/** Builds the job registry. Queues are created by the {@link ConfiguredQueues} service. */
	public override onInit(): void {
		JobRegistry.set(JobRegistry.collect());
	}

	/** Clears the module-level job registry. */
	public override onDestroy(): void {
		JobRegistry.clear();
	}
}
