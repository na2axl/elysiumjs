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
import type { TestingApp } from '../../src/index';
import type { RedisConnection } from '../../src/redis/index';

import { Application } from '../../src/index';
import { RedisModule } from '../../src/redis/index';
import { afterEach, describe, expect, it } from 'bun:test';

import { TransportMode } from '../../src/heracles/transport';
import { RedisTransport } from '../../src/heracles/transports/redis.transport';

/** Implements exactly the RedisConnection surface: any other method call throws a TypeError. */
class FakeConnection implements RedisConnection {
	public connected = true;
	public readonly commands: string[] = [];
	public readonly subscriptions: string[] = [];

	public async send(command: string, _args: string[]): Promise<unknown> {
		this.commands.push(command);
		return command === 'KEYS' ? [] : 'OK';
	}
	public async get(): Promise<string | null> {
		return null;
	}
	public async set(): Promise<unknown> {
		return 'OK';
	}
	public async del(): Promise<number> {
		return 0;
	}
	public async expire(): Promise<number> {
		return 1;
	}
	public async subscribe(channel: string): Promise<unknown> {
		this.subscriptions.push(channel);
		return null;
	}
	public async unsubscribe(): Promise<unknown> {
		return null;
	}
	public async duplicate(): Promise<RedisConnection> {
		return this;
	}
	public async connect(): Promise<void> {}
	public close(): void {}
}

describe('heracles uses only the RedisConnection surface', () => {
	let app: TestingApp | undefined;

	afterEach(async () => {
		await app?.shutdown();
		app = undefined;
	});

	it('starts a consumer transport and dispatches a job through the fake connection', async () => {
		const fake = new FakeConnection();
		app = await Application.testing({
			modules: [
				RedisModule.with({
					default: 'default',
					client: () => fake,
					connections: { default: { url: 'redis://fake:6379' } }
				})
			],
			boot: 'eager'
		});

		const transport = new RedisTransport(TransportMode.CONSUMER, {
			cleanupCompletedJobs: false
		});
		await transport.start();

		expect(fake.commands).toContain('PING');
		expect(fake.commands).toContain('KEYS');
		expect(fake.subscriptions.length).toBeGreaterThan(0);

		await transport.send({
			type: 'job:process',
			jobId: 'j1',
			dispatchId: 'd1',
			queue: 'default',
			name: 'TestJob',
			args: [],
			options: {}
		} as any);
		expect(fake.commands).toContain('XADD');
		expect(fake.commands).toContain('PUBLISH');

		await transport.stop();
	});
});
