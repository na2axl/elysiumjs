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

import type { OutputLevel, Runtime } from '@elysiumjs/olympus';

import { RuntimeNotSupportedError } from '@elysiumjs/olympus';

/** The console method of each level. */
const CONSOLE_METHODS: Record<OutputLevel, 'debug' | 'info' | 'warn' | 'error'> = {
	trace: 'debug',
	debug: 'debug',
	info: 'info',
	warn: 'warn',
	error: 'error',
	fatal: 'error'
};

/**
 * Options of {@link createRuntime}.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type WorkersRuntimeOptions = {
	/**
	 * The environment variables to expose. Defaults to `process.env`, which workerd fills from
	 * the Worker's vars and secrets with the `nodejs_compat` flag.
	 */
	env?: Record<string, string | undefined>;
};

/**
 * Creates the Elysium runtime for Cloudflare Workers. The host owns the server and the isolate's
 * lifetime: export the app's `fetch` from the Worker instead of serving, and nothing exits or
 * receives signals.
 * @param options The runtime options.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export const createRuntime = (options: WorkersRuntimeOptions = {}): Runtime => ({
	name: 'workers',
	// portability-allow: the nodejs_compat env, when the Worker gives none
	env: () => options.env ?? (typeof process === 'undefined' ? {} : process.env),
	sleep: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
	serve() {
		throw new RuntimeNotSupportedError(
			'Application.serve',
			'workers',
			"Export the app's fetch handler from the Worker instead."
		);
	},
	exit() {},
	argv: () => [],
	write(stream, text, level) {
		// console adds its own newline, and Workers Logs takes the level of a line from its method.
		const line = text.endsWith('\n') ? text.slice(0, -1) : text;
		console[level ? CONSOLE_METHODS[level] : stream === 'stderr' ? 'error' : 'log'](line);
	},
	terminal: () => undefined,
	clientAddress: (request) => request.headers.get('cf-connecting-ip') ?? undefined,
	onShutdown() {
		return () => {};
	}
});

/**
 * The Workers runtime reading `process.env`.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export const runtime: Runtime = createRuntime();
