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

import type { Job, JobClass } from './job';
import type { JobDispatchId, JobDispatchOptions } from './queue';

import { Service } from '@elysiumjs/core';
import { uid } from 'radash';

import { Queue } from './queue';
import { QUEUES_SERVICE } from './registry';
import { getJobMetadata } from './utils';

export namespace Heracles {
	/**
	 * Dispatch a job to be executed asynchronously.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param jobClass The job class to dispatch. Should extend the base {@link Job} class and have the {@link Job.register} decorator set.
	 * @param args The arguments to pass to the job constructor.
	 * @param options Additional options for the job dispatch.
	 * @returns The ID of the dispatched job.
	 */
	export const dispatch = async <T extends Job, TClass extends JobClass<T> = JobClass<T>>(
		jobClass: TClass,
		args: ConstructorParameters<TClass> = [] as any,
		options: JobDispatchOptions = {}
	): Promise<JobDispatchId> => {
		// Check if job class is registered properly
		const metadata = getJobMetadata(jobClass);
		if (!metadata) {
			throw new Error(`Job ${jobClass.name} is not marked with @Job.register() decorator`);
		}

		if (!metadata.queue) {
			throw new Error(`Job ${jobClass.name} is not registered with a queue`);
		}

		// Configured queues are created by the 'heracles.queues' service; resolving it also
		// initialises HeraclesModule, which works on a lazy boot too.
		if (Service.exists(QUEUES_SERVICE)) await Service.resolve(QUEUES_SERVICE);

		if (!Queue.exists(metadata.queue)) {
			throw new Error(
				`Queue ${metadata.queue} does not exist. Please create the queue before dispatching the job.`
			);
		}

		const queue = Queue.get(metadata.queue);

		// Producers don't have to start queues: the first dispatch does, shared across callers.
		await queue.start();

		// Generate a unique dispatch ID for this job dispatch
		const dispatchId = `dispatch_${Date.now()}_${uid(8)}`;

		// Include overlap behavior information in the options
		const dispatchOptions: JobDispatchOptions = {
			dispatchId,
			priority: metadata.priority,
			maxRetries: metadata.maxRetries,
			retryDelay: metadata.retryDelay,
			overlapBehavior: metadata.overlapBehavior,
			overlapDelay: metadata.overlapDelay,
			...options
		};

		return queue.dispatch(jobClass, metadata.name, args, dispatchOptions);
	};
}
