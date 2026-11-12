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

import type { JobDispatchOptions } from '../heracles/index';
import type { NotificationRun } from './queued';

import { Clock } from '../clock';
import { ElysiumError } from '../errors';
import { Heracles, Job, JobRegistry, Queue, QUEUES_SERVICE } from '../heracles/index';
import { DATABASE_TRANSACTION_SERVICE } from '../index';
import { UnitOfWork } from '../mnemosyne/unit-of-work';
import { MOIRAI_INBOX_STORE, MOIRAI_OUTBOX_STORE } from '../moirai/config';
import { job } from '../moirai/heracles';
import { Inbox, Outbox } from '../moirai/outbox';
import { Service } from '../service';
import { HERMES_NOTIFICATION_JOB } from './config';
import { QueuedNotificationsUnavailableError } from './errors';
import { prepareRun, runQueuedNotification } from './queued';
import { setNotificationQueue } from './registry';

/**
 * The job that delivers queued notifications, one per notifiable and channel entry; a fallback
 * chain runs in order inside it. List it in the `jobs` of one module, next to `HeraclesModule`,
 * in the processes that send notifications and in those that deliver them.
 *
 * A job may run more than once. Its dispatch id is derived from the delivery id, which the inbox
 * keeps and mail transports receive, so that they can drop a second delivery. With the inbox
 * store of moirai and a database, a delivery that completed is recorded and not run again.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @example
 * ```ts
 * import { NotificationJob } from '@elysiumjs/olympus/hermes/heracles';
 *
 * @Module.register({ jobs: [NotificationJob] })
 * class AppModule extends Module {}
 * ```
 */
@Job.register({ name: HERMES_NOTIFICATION_JOB })
export class NotificationJob extends Job {
	public static override readonly description: string = 'Delivers a queued notification.';

	constructor(private readonly delivery: NotificationRun) {
		super();
	}

	protected async execute(): Promise<void> {
		const work = () => runQueuedNotification(this.delivery);
		if (Service.get(MOIRAI_INBOX_STORE) && Service.exists(DATABASE_TRANSACTION_SERVICE)) {
			await UnitOfWork.run(async () => {
				await Inbox.once(
					{ messageId: `notification_${this.delivery.id}`, consumer: HERMES_NOTIFICATION_JOB },
					work
				);
			});
			return;
		}
		await work();
	}
}

type Prepared = { readonly run: NotificationRun; readonly options: JobDispatchOptions };

setNotificationQueue({
	prepare: async (notifiable, notification, options, chain, id) => {
		// Resolving the queues also initialises HeraclesModule, which fills the job registry.
		if (Service.exists(QUEUES_SERVICE)) await Service.resolve(QUEUES_SERVICE);
		if (!JobRegistry.all().some((entry) => entry.jobClass === NotificationJob)) {
			throw new QueuedNotificationsUnavailableError(options.type);
		}
		if (!Queue.exists(options.queue)) {
			throw new ElysiumError(
				`Queue ${options.queue} does not exist: configure it in HeraclesModule.`
			);
		}
		const run = await prepareRun(notifiable, notification, options.type, chain, id);
		const delay =
			typeof options.delay === 'number' ? options.delay : options.delay?.[chain[0] as string];
		return {
			run,
			options: {
				queue: options.queue,
				jobId: NotificationJob.generateJobId(),
				dispatchId: `notification_${id}`,
				...(delay ? { scheduledFor: new Date(Clock.now().getTime() + delay) } : {}),
				...(options.priority === undefined ? {} : { priority: options.priority }),
				...(options.maxRetries === undefined ? {} : { maxRetries: options.maxRetries })
			}
		} satisfies Prepared;
	},
	dispatch: async (prepared, options) => {
		const jobs = prepared as readonly Prepared[];
		const send = async () => {
			for (const { run, options: dispatch } of jobs) {
				await Heracles.dispatch(NotificationJob, [run], dispatch);
			}
		};
		if (options.afterCommit === false || !UnitOfWork.active()) {
			await send();
		} else if (Service.get(MOIRAI_OUTBOX_STORE)) {
			// The jobs are stored with the unit of work, and dispatched once it commits.
			for (const { run, options: dispatch } of jobs) {
				await Outbox.enqueue(job(NotificationJob, [run], dispatch));
			}
		} else {
			await UnitOfWork.afterCommit(send);
		}
	}
});
