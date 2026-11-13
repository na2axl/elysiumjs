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

import { Job } from '../heracles/index';
import { Files } from './files';

/**
 * The base of the job that prunes files: uploads never finished, whose staged object it deletes,
 * and ready files nothing claims, whose object it deletes. A subclass registers it, usually on a
 * schedule; each run prunes files `chunkSize` at a time until none is due.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @example
 * ```ts
 * @Job.register({ queue: 'maintenance' })
 * @Scheduler.job('*\/15 * * * *')
 * export class PruneFiles extends FilesPruner {}
 * ```
 */
export abstract class FilesPruner extends Job {
	/** How many files were pruned by the last run. */
	public pruned = 0;

	/** How many files each round prunes, read on each run. Defaults to 100. */
	protected get chunkSize(): number {
		return 100;
	}

	protected async execute(): Promise<void> {
		const size = Math.max(1, Math.floor(this.chunkSize));
		this.pruned = 0;
		for (;;) {
			const pruned = await Files.prune(size);
			this.pruned += pruned;
			if (pruned < size) break;
		}
	}
}
