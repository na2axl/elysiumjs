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

import type { WorkersQueueMessage, WorkersScheduledController } from '@elysiumjs/runtime-workers';
import type { DeadJob } from './consumer';

import { getLogger, Module, Service } from '@elysiumjs/core';
import { HeraclesModule, Scheduler } from '@elysiumjs/heracles';
import { Workers } from '@elysiumjs/runtime-workers';

import { runJobMessage } from './consumer';

/**
 * Configuration of the {@link HeraclesWorkersModule}.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type HeraclesWorkersConfig = {
	/** Called with each job that failed its last retry, such as to alert. A failing hook is logged. */
	onDead?: (dead: DeadJob) => unknown;
};

/** The config of the module, or none when it is not visible. */
const configOf = (): HeraclesWorkersConfig =>
	Service.get<HeraclesWorkersConfig>(HeraclesWorkersModule.config) ?? {};

/**
 * Consumes the Heracles jobs of every queue, and dispatches the scheduled jobs of each cron
 * trigger.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
@Service.register()
export class HeraclesWorkersHandlers {
	/** Runs the job a message carries. */
	@Workers.queue('*', { each: true })
	public async consume(message: WorkersQueueMessage): Promise<void> {
		await runJobMessage(message, configOf());
	}

	/**
	 * Dispatches the scheduled jobs whose expression is the cron of the trigger, at the time of
	 * the trigger: a fan-out schedule selects its cases for that tick.
	 */
	@Workers.cron('*')
	public async schedule(controller: WorkersScheduledController): Promise<void> {
		for (const job of Scheduler.jobsFor(controller.cron)) {
			try {
				await Scheduler.dispatch(job, new Date(controller.scheduledTime));
			} catch (error) {
				getLogger().error('Could not dispatch a scheduled job', {
					job: job.name,
					cron: controller.cron,
					error
				});
			}
		}
	}
}

/**
 * Runs Heracles on Cloudflare Workers: consumes the jobs sent with `CloudflareQueueTransport`
 * from the Worker's queues (`queue` handler), and dispatches the scheduled jobs whose
 * expression is the cron of a trigger (`scheduled` handler). Declare each consumer queue and each
 * cron expression in the wrangler config. A queue keeps the jobs that failed their last retry with
 * the `deadLetterQueue` of its `transportOptions`; `.with({ onDead })` also hands each one to a hook.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @example
 * ```ts
 * @Application.register({
 * 	runtime,
 * 	modules: [
 * 		HeraclesModule.with({
 * 			queues: {
 * 				emails: {
 * 					transport: CloudflareQueueTransport,
 * 					transportOptions: { binding: 'EMAILS', deadLetterQueue: 'EMAILS_DLQ' }
 * 				}
 * 			}
 * 		}),
 * 		HeraclesWorkersModule,
 * 		MailModule
 * 	]
 * })
 * class App extends Application {}
 * ```
 */
@Module.register({ imports: [HeraclesModule], services: [HeraclesWorkersHandlers] })
export class HeraclesWorkersModule extends Module.configurable<HeraclesWorkersConfig>() {}
