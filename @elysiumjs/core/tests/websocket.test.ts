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
import { Elysia as ElysiaApp } from 'elysia';

import { Http } from '../src/http';
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

/** Rejects every request that has no `token` query parameter, before anything else runs. */
class EarlyTokenMiddleware extends Middleware {
	public onRequest(ctx: Context) {
		if (!new URL(ctx.request.url).searchParams.get('token')) return ctx.status(401, 'Unauthorized');
	}
}

@Websocket.controller({ path: '/feed' })
@Middleware.register(EarlyTokenMiddleware)
class FeedController {
	@Websocket.onMessage()
	public message(ws: any, message: string) {
		ws.send(`feed:${message}`);
	}
}

@Http.controller({ path: '/health' })
class HealthController {
	@Http.get({ path: '/' })
	public get() {
		return 'ok';
	}
}

/** Refuses requests with a plain Response, as an auth or maintenance middleware would. */
class ResponseGuardMiddleware extends Middleware {
	public onRequest(ctx: Context) {
		if (!ctx.request.headers.get('authorization')) {
			return new Response('denied', { status: 401, headers: { 'x-guard': 'yes' } });
		}
	}
}

@Http.controller({ path: '/secret' })
@Middleware.register(ResponseGuardMiddleware)
class SecretController {
	@Http.post({ path: '/' })
	public post() {
		return 'secret';
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
		setTimeout(() => reject(new Error('no echo received')), 1000);
	});

/** Mounts the feed and health controllers in one module plugin, like the application does. */
const serveModule = async () => {
	const node = testNode();
	const module = new ElysiaApp({ name: node.id });
	for (const controller of [FeedController, HealthController, SecretController]) {
		module.use(await Metadata.get(Symbols.elysiaPlugin, controller)(node));
	}
	const app = new ElysiaApp().use(module).listen(0) as unknown as Elysia;
	servers.push(app);
	return app.server!.port;
};

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

	it('scopes the onRequest middlewares of a websocket controller to its own route', async () => {
		const port = await serveModule();

		await expect(exchange(`ws://localhost:${port}/feed`)).rejects.toThrow('connection refused');
		expect(await exchange(`ws://localhost:${port}/feed?token=abc`)).toBe('feed:hi');

		const response = await fetch(`http://localhost:${port}/health`);
		expect(response.status).toBe(200);
		expect(await response.text()).toBe('ok');
	});

	it('stops the request when a controller onRequest middleware returns a Response', async () => {
		const port = await serveModule();
		const post = (headers: Record<string, string> = {}) =>
			fetch(`http://localhost:${port}/secret`, {
				method: 'POST',
				body: '{}',
				headers: { 'content-type': 'application/json', ...headers }
			});

		const denied = await post();
		expect(denied.status).toBe(401);
		expect(denied.headers.get('x-guard')).toBe('yes');
		expect(await denied.text()).toBe('denied');

		const allowed = await post({ authorization: 'Bearer abc' });
		expect(await allowed.text()).toBe('secret');
	});
});
