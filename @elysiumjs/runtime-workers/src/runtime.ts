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

import type { Runtime } from '@elysiumjs/core';

import { RuntimeNotSupportedError } from '@elysiumjs/core';

/**
 * Options of {@link createRuntime}.
 * @author Axel Nana <axel.nana@workbud.com>
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
 * @author Axel Nana <axel.nana@workbud.com>
 */
export const createRuntime = (options: WorkersRuntimeOptions = {}): Runtime => ({
	name: 'workers',
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
	write(stream, text) {
		if (stream === 'stderr') console.error(text);
		else console.log(text);
	},
	terminal: () => undefined,
	onShutdown() {
		return () => {};
	}
});

/**
 * The Workers runtime reading `process.env`.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export const runtime: Runtime = createRuntime();
