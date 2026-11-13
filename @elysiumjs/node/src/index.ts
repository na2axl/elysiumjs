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

import { peerAddress, serveNode } from './serve';

export { type FetchHandler, peerAddress, serveNode } from './serve';
export { LocalDisk } from './storage';

const SIGNALS = ['SIGINT', 'SIGTERM'] as const;

/**
 * The Elysium runtime for Node.js. It serves the app's `fetch` handler on a `node:http` server
 * through {@link serveNode}, a bridge used instead of an Elysia Node adapter because none is
 * released for Elysia 2 yet (`@elysia/node` only has `2.0.0-exp.*` builds).
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export const runtime: Runtime = {
	name: 'node',
	env: () => process.env,
	sleep: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
	serve(app, port) {
		const server = serveNode(async (request) => app.fetch(request), port);
		return {
			close: () =>
				new Promise<void>((resolve, reject) => {
					server.close((error) => (error ? reject(error) : resolve()));
					// Keep-alive sockets with no request in flight would hold the server open.
					server.closeIdleConnections();
				})
		};
	},
	clientAddress: peerAddress,
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
