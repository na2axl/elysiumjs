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

import { EventEmitter } from 'node:events';

import { ElysiumError } from '../../src/index';
import { describe, expect, it } from 'bun:test';

import { ioredis, RedisFeatureNotSupportedError, upstash } from '../../src/redis';

/** An ioredis stand-in that records its calls. */
class FakeIoredis extends EventEmitter {
	public status = 'wait';
	public calls: string[] = [];
	public readonly url: string;

	constructor(url: string) {
		super();
		this.url = url;
	}

	async call(command: string, ...args: string[]) {
		this.calls.push([command, ...args].join(' '));
		return 'OK';
	}
	async get(key: string) {
		this.calls.push(`GET ${key}`);
		return 'v';
	}
	async set(key: string, value: string) {
		this.calls.push(`SET ${key} ${value}`);
		return 'OK';
	}
	async del(...keys: string[]) {
		return keys.length;
	}
	async expire() {
		return 1;
	}
	async subscribe(channel: string) {
		this.calls.push(`SUBSCRIBE ${channel}`);
		return 1;
	}
	async unsubscribe(...channels: string[]) {
		this.calls.push(`UNSUBSCRIBE ${channels.join(' ')}`.trim());
		return 1;
	}
	duplicate() {
		return new FakeIoredis(this.url);
	}
	async connect() {
		this.status = 'ready';
		this.emit('ready');
	}
	async quit() {
		this.status = 'end';
		this.emit('end');
		return 'OK';
	}
}

describe('ioredis', () => {
	it('adapts an ioredis client to the connection port', async () => {
		let created: FakeIoredis | undefined;
		const factory = ioredis((url) => (created = new FakeIoredis(url)));
		const connection = factory('redis://localhost:6379', {});
		let connected = false;
		connection.onconnect = () => (connected = true);

		expect(connection.connected).toBe(false);
		await connection.connect();
		expect(connected).toBe(true);
		expect(connection.connected).toBe(true);

		await connection.send('ZADD', ['k', '1', 'a']);
		expect(await connection.get('k')).toBe('v');
		expect(await connection.del('a', 'b')).toBe(2);
		expect(created!.calls).toEqual(['ZADD k 1 a', 'GET k']);
	});

	it('routes pub/sub messages to the listener of their channel', async () => {
		let created: FakeIoredis | undefined;
		const connection = ioredis((url) => (created = new FakeIoredis(url)))('redis://x', {});
		const received: string[] = [];
		await connection.subscribe('jobs', (message, channel) =>
			received.push(`${channel}:${message}`)
		);
		created!.emit('message', 'jobs', 'hello');
		created!.emit('message', 'other', 'ignored');
		await connection.unsubscribe('jobs');
		created!.emit('message', 'jobs', 'late');

		expect(received).toEqual(['jobs:hello']);
	});

	it('duplicates into a new client and closes with quit', async () => {
		const connection = ioredis((url) => new FakeIoredis(url))('redis://x', {});
		const copy = await connection.duplicate();
		expect(copy).not.toBe(connection);
		let closed = false;
		connection.onclose = () => (closed = true);
		await connection.close();
		expect(closed).toBe(true);
	});
});

describe('upstash', () => {
	const fakeFetch = (answer: (body: string[]) => { status?: number; json: unknown }) => {
		const requests: { url: string; auth: string | null; body: string[] }[] = [];
		const fetcher = (async (url: string, init: RequestInit) => {
			const body = JSON.parse(String(init.body)) as string[];
			requests.push({ url, auth: new Headers(init.headers).get('authorization'), body });
			const { status = 200, json } = answer(body);
			return new Response(JSON.stringify(json), { status });
		}) as unknown as typeof fetch;
		return { fetcher, requests };
	};

	it('sends each command as a REST request with the token', async () => {
		const { fetcher, requests } = fakeFetch((body) => ({
			json: { result: body[0] === 'INCR' ? 3 : 'OK' }
		}));
		const connection = upstash({ token: 't0k', fetch: fetcher })('https://db.upstash.io/', {});

		expect(await connection.send('INCR', ['hits'])).toBe(3);
		expect(await connection.set('k', 'v')).toBe('OK');
		expect(requests).toEqual([
			{ url: 'https://db.upstash.io', auth: 'Bearer t0k', body: ['INCR', 'hits'] },
			{ url: 'https://db.upstash.io', auth: 'Bearer t0k', body: ['SET', 'k', 'v'] }
		]);
	});

	it('raises the error Upstash answers', async () => {
		const { fetcher } = fakeFetch(() => ({ status: 400, json: { error: 'ERR wrong type' } }));
		const connection = upstash({ token: 't', fetch: fetcher })('https://db', {});

		await expect(connection.send('INCR', ['k'])).rejects.toThrow('ERR wrong type');
	});

	it('does not support pub/sub', async () => {
		const connection = upstash({ token: 't', fetch: fetch })('https://db', {});
		await expect(connection.subscribe('c', () => {})).rejects.toBeInstanceOf(
			RedisFeatureNotSupportedError
		);
	});

	it('refuses a connection without a REST URL or a token', () => {
		expect(() => upstash({ token: 't0k' })(undefined as unknown as string, {})).toThrow(
			ElysiumError
		);
		expect(() => upstash({ token: '' })('https://db.upstash.io', {})).toThrow(/REST token/);
	});
});
