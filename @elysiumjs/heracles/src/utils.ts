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

import type { Job, JobClass, JobMetadata } from './job';

import { Metadata } from '@elysiumjs/core';

export namespace Symbols {
	/**
	 * Symbol for job metadata
	 */
	export const job = Symbol('elysium:job');

	/**
	 * Symbol for queue metadata
	 */
	export const queue = Symbol('elysium:queue');

	/**
	 * Symbol for worker metadata
	 */
	export const worker = Symbol('elysium:worker');

	/**
	 * Symbol for transport metadata
	 */
	export const transport = Symbol('elysium:transport');

	/**
	 * Symbol for job transaction data
	 */
	export const jobTransaction = Symbol('elysium:jobTransaction');

	/**
	 * Symbol for worker pool metadata
	 */
	export const workerPool = Symbol('elysium:workerPool');
}

/**
 * Get job metadata from a job class
 * @author Axel Nana <axel.nana@workbud.com>
 * @param jobClass The job class
 * @returns The job metadata or null if not found
 */
export const getJobMetadata = <T extends Job>(jobClass: JobClass<T>): JobMetadata | null => {
	if (!Metadata.has(Symbols.job, jobClass)) {
		return null;
	}

	return Metadata.get(Symbols.job, jobClass) as JobMetadata;
};
