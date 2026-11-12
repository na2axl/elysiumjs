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

import type { Runtime } from '@elysiumjs/olympus';

const SIGNALS = ['SIGINT', 'SIGTERM'] as const;

/** The server started by `serve`, which knows the peer address of its requests. */
let server: { requestIP(request: Request): { address: string } | null } | undefined;

/**
 * The Elysium runtime for Bun.
 *
 * ```ts
 * @Application.register({ runtime, modules: [...] })
 * class App extends Application {}
 * ```
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export const runtime: Runtime = {
	name: 'bun',
	env: () => Bun.env,
	sleep: (ms) => Bun.sleep(ms),
	serve(app, port) {
		app.listen(port);
		server = app.server ?? undefined;
	},
	clientAddress: (request) => server?.requestIP(request)?.address,
	exit(code) {
		process.exit(code);
	},
	argv: () => process.argv.slice(2),
	write(stream, text) {
		process[stream].write(text);
	},
	terminal: () => ({
		input: process.stdin,
		output: process.stdout,
		setRawMode: (on) => process.stdin.setRawMode?.(on),
		clear: () => void process.stdout.write('\x1Bc'),
		moveCursor: (x, y) => void process.stdout.moveCursor?.(x, y),
		clearLine: () => {
			process.stdout.clearLine?.(0);
			process.stdout.cursorTo?.(0);
		}
	}),
	onShutdown(handler) {
		for (const signal of SIGNALS) process.on(signal, handler);
		return () => {
			for (const signal of SIGNALS) process.off(signal, handler);
		};
	}
};
