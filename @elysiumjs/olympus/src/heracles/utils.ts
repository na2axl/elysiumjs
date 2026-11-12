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

import type { Job, JobClass, JobMetadata } from './job';

import { Metadata } from '../index';

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
 * @author Axel Nana <ax.lnana@outlook.com>
 * @param jobClass The job class
 * @returns The job metadata or null if not found
 */
export const getJobMetadata = <T extends Job>(jobClass: JobClass<T>): JobMetadata | null => {
	if (!Metadata.has(Symbols.job, jobClass)) {
		return null;
	}

	return Metadata.get(Symbols.job, jobClass) as JobMetadata;
};

/** Leading comments and blanks, skipped when looking past a comma. */
const COMMENTS = /^(?:\s|\/\/[^\n]*|\/\*[\s\S]*?\*\/)*/;

/**
 * Parses JSON with comments and trailing commas, such as a `wrangler.jsonc` file.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @param text The text.
 * @returns The parsed value.
 * @throws {SyntaxError} When the text is not valid JSON once comments are removed.
 */
export const parseJsonc = (text: string): unknown => {
	// Removes the comments, then the commas before a closing bracket, outside strings.
	let stripped = '';
	for (let i = 0; i < text.length; i++) {
		const char = text[i]!;
		if (char === '"') {
			const start = i;
			for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === '\\') i++;
			stripped += text.slice(start, i + 1);
		} else if (char === '/' && text[i + 1] === '/') {
			while (i < text.length && text[i] !== '\n') i++;
			stripped += '\n';
		} else if (char === '/' && text[i + 1] === '*') {
			const end = text.indexOf('*/', i + 2);
			i = end === -1 ? text.length : end + 1;
		} else if (char === ',' && /^\s*[}\]]/.test(text.slice(i + 1).replace(COMMENTS, ''))) {
			continue;
		} else {
			stripped += char;
		}
	}
	return JSON.parse(stripped);
};
