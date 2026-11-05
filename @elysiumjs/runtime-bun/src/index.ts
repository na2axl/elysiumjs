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

const SIGNALS = ['SIGINT', 'SIGTERM'] as const;

/**
 * The Elysium runtime for Bun.
 *
 * ```ts
 * @Application.register({ runtime: bunRuntime, modules: [...] })
 * class App extends Application {}
 * ```
 * @author Axel Nana <axel.nana@workbud.com>
 */
export const bunRuntime: Runtime = {
	name: 'bun',
	env: () => Bun.env,
	sleep: (ms) => Bun.sleep(ms),
	serve(app, port) {
		app.listen(port);
	},
	exit(code) {
		process.exit(code);
	},
	onShutdown(handler) {
		for (const signal of SIGNALS) process.on(signal, handler);
		return () => {
			for (const signal of SIGNALS) process.off(signal, handler);
		};
	}
};
