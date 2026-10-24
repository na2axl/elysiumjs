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

import 'reflect-metadata';

import { Job } from '../src/job';

/**
 * Helper to create a test job class that records execution.
 */
export function makeTestJobClass(
	name: string,
	delayMs: number,
	outputRef: { input?: string; output?: string }
) {
	@Job.register({ name })
	class TestJob extends Job {
		static displayName = name;

		public constructor(input: string) {
			super();
			outputRef.input = input;
		}

		protected async execute(): Promise<void> {
			await Bun.sleep(delayMs);
			outputRef.output = `${name}-done-${this.id}`;
		}
	}
	Object.defineProperty(TestJob, 'name', { value: name });
	return TestJob;
}
