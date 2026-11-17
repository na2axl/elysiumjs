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

import type { WorkflowDriver } from './driver.js';

import { Module, Service } from '../index.js';
import { OdysseusWorkCommand } from './commands/index.js';
import { ODYSSEUS_DRIVER, WorkflowRegistry } from './workflow.js';

import './engine/engine.js';
import './engine/store.js';

/**
 * The configuration of {@link OdysseusModule}.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type OdysseusModuleConfig = {
	/** The driver that runs the workflows: an instance, or a function that builds it once. */
	driver: WorkflowDriver | (() => WorkflowDriver);
};

/**
 * Runs the workflows that the modules list in their `workflows`, with a driver: `engine` (in the
 * process, over a store) or `cloudflare` (Cloudflare Workflows, from `@elysiumjs/workers`). With
 * the `engine` driver, the `odysseus:work` command starts a worker process.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @example
 * ```ts
 * @Application.register({
 * 	modules: [
 * 		OdysseusModule.with({
 * 			driver: () => Workflows.for('engine', { store: WorkflowStore.for('memory') })
 * 		}),
 * 		OrdersModule
 * 	]
 * })
 * class App extends Application {}
 * ```
 */
@Module.register<OdysseusModuleConfig>({
	commands: [OdysseusWorkCommand],
	services: (config) => {
		let built: WorkflowDriver | undefined;
		return [
			{
				name: ODYSSEUS_DRIVER,
				global: true,
				factory: (): WorkflowDriver =>
					(built ??= typeof config.driver === 'function' ? config.driver() : config.driver)
			}
		];
	}
})
export class OdysseusModule extends Module.configurable<OdysseusModuleConfig>({
	required: ['driver']
}) {
	/** Reads the workflows of the modules and opens the driver. */
	public override async onInit(): Promise<void> {
		WorkflowRegistry.set(WorkflowRegistry.collect());
		await Service.get<WorkflowDriver>(ODYSSEUS_DRIVER)?.open?.(WorkflowRegistry.host);
	}

	/** Closes the driver and forgets the workflows. */
	public override async onDestroy(): Promise<void> {
		await Service.get<WorkflowDriver>(ODYSSEUS_DRIVER)?.close?.();
		WorkflowRegistry.clear();
	}
}
