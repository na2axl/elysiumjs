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

import type { Elysia } from 'elysia';
import type { Context } from '../src/http';

import { afterEach, describe, expect, it } from 'bun:test';

import { Metadata } from '../src/metadata';
import { Middleware } from '../src/middleware';
import { Symbols } from '../src/utils';
import { Websocket } from '../src/websocket';
import { testNode } from './module-node';

/** Rejects every upgrade request that has no `token` query parameter. */
class TokenMiddleware extends Middleware {
	public onBeforeHandle(ctx: Context) {
		if (!ctx.query.token) return ctx.status(401, 'Unauthorized');
	}
}

@Websocket.controller({ path: '/chat' })
@Middleware.register(TokenMiddleware)
class ChatController {
	@Websocket.onMessage()
	public message(ws: any, message: string) {
		ws.send(`echo:${message}`);
	}
}

const servers: Elysia[] = [];

/** Builds the controller plugin and serves it on a random port. */
const serve = async () => {
	const plugin = Metadata.get(Symbols.elysiaPlugin, ChatController);
	const app: Elysia = (await plugin(testNode())).listen(0);
	servers.push(app);
	return `ws://localhost:${app.server!.port}/chat`;
};

/** Opens a websocket and resolves with the first echoed message, or rejects on close. */
const exchange = (url: string) =>
	new Promise<string>((resolve, reject) => {
		const socket = new WebSocket(url);
		socket.onopen = () => socket.send('hi');
		socket.onmessage = (event) => {
			resolve(String(event.data));
			socket.close();
		};
		socket.onerror = () => reject(new Error('connection refused'));
	});

afterEach(async () => {
	await Promise.all(servers.splice(0).map((server) => server.stop(true)));
});

describe('Websocket controller middlewares', () => {
	it('rejects the upgrade when a controller middleware returns a response', async () => {
		const url = await serve();
		await expect(exchange(url)).rejects.toThrow('connection refused');
	});

	it('opens the connection when the controller middlewares pass', async () => {
		const url = await serve();
		expect(await exchange(`${url}?token=abc`)).toBe('echo:hi');
	});
});
