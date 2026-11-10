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

import { describe, expect, it } from 'bun:test';

import { Job } from '../src/job';
import { getJobMetadata, parseJsonc, Symbols } from '../src/utils';

describe('Symbols', () => {
	it('should expose distinct symbol values', () => {
		expect(typeof Symbols.job).toBe('symbol');
		expect(typeof Symbols.queue).toBe('symbol');
		expect(typeof Symbols.worker).toBe('symbol');
		expect(typeof Symbols.transport).toBe('symbol');
		expect(typeof Symbols.jobTransaction).toBe('symbol');
		expect(typeof Symbols.workerPool).toBe('symbol');

		// All symbols should be unique
		const all = [
			Symbols.job,
			Symbols.queue,
			Symbols.worker,
			Symbols.transport,
			Symbols.jobTransaction,
			Symbols.workerPool
		];
		const unique = new Set(all);
		expect(unique.size).toBe(all.length);
	});
});

describe('getJobMetadata', () => {
	it('should return null for an undecorated class', () => {
		class UndecoratedJob extends Job {
			protected async execute(): Promise<void> {}
		}

		expect(getJobMetadata(UndecoratedJob as any)).toBeNull();
	});

	it('should return metadata for a decorated class', () => {
		@Job.register({ name: 'MetadataTestJob', queue: 'test-queue', priority: 5 })
		class MetadataTestJob extends Job {
			protected async execute(): Promise<void> {}
		}

		const metadata = getJobMetadata(MetadataTestJob as any);
		expect(metadata).not.toBeNull();
		expect(metadata!.name).toBe('elysium.heracles.job.MetadataTestJob');
		expect(metadata!.queue).toBe('test-queue');
		expect(metadata!.priority).toBe(5);
	});

	it('should return metadata with defaults when no options are provided', () => {
		@Job.register()
		class DefaultMetadataJob extends Job {
			protected async execute(): Promise<void> {}
		}

		const metadata = getJobMetadata(DefaultMetadataJob as any);
		expect(metadata).not.toBeNull();
		expect(metadata!.queue).toBe('default');
		expect(metadata!.priority).toBe(0);
	});
});

describe('parseJsonc', () => {
	it('reads JSON with comments and trailing commas, and leaves strings alone', () => {
		const text = `{
			// the worker
			"name": "a,}b", /* block */
			"url": "http://x//y",
			"triggers": { "crons": ["0 6 * * *", "*/5 * * * *", /* last */ ], },
		}`;
		expect(parseJsonc(text)).toEqual({
			name: 'a,}b',
			url: 'http://x//y',
			triggers: { crons: ['0 6 * * *', '*/5 * * * *'] }
		});
	});
});
