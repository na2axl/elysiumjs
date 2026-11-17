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

import type { WorkflowDriver } from '../driver.js';

import { Command, ConsoleFormat, ElysiumError, Service } from '../../index.js';
import { EngineDriver } from '../engine/engine.js';
import { MemoryWorkflowStore } from '../engine/store.js';
import { ODYSSEUS_DRIVER } from '../workflow.js';

/**
 * Runs workflow instances in this process until it stops: the worker process of the `engine`
 * driver. Workers share the instances through the store of the driver, so the store must be
 * one that every process reaches, such as the PostgreSQL store of `@elysiumjs/drizzle` or the
 * Redis store of `@elysiumjs/redis`.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
@Command.register()
export class OdysseusWorkCommand extends Command {
	public static readonly command: string = 'odysseus:work';
	public static readonly description: string =
		'Run workflow instances in this process, until it stops.';
	public static readonly boot = true;

	public async run(): Promise<void> {
		const driver = Service.get<WorkflowDriver>(ODYSSEUS_DRIVER);
		if (!(driver instanceof EngineDriver)) {
			throw new ElysiumError(
				'Only the `engine` driver of OdysseusModule runs instances in workers.'
			);
		}
		if (driver.store instanceof MemoryWorkflowStore) {
			throw new ElysiumError(
				'The `memory` workflow store lives in one process, so a worker cannot share it: use the store of @elysiumjs/drizzle or @elysiumjs/redis.'
			);
		}
		this.write(
			`${this.format('Running workflow instances.', ConsoleFormat.GREEN)} Stop the process to end the worker.`
		);
		await driver.work();
	}
}
