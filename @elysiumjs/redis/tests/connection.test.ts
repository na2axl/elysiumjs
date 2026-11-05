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
import type { TestingApp } from '@elysiumjs/core';
import type { RedisConnection } from '../src/connection';

import { Application } from '@elysiumjs/core';
import { afterEach, describe, expect, it } from 'bun:test';

import { Redis, RedisModule } from '../src/redis';

class FakeConnection implements RedisConnection {
	public closed = false;
	public connected = true;

	public async send(): Promise<unknown> {
		return null;
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
		return 0;
	}
	public async subscribe(): Promise<unknown> {
		return null;
	}
	public async unsubscribe(): Promise<unknown> {
		return null;
	}
	public async duplicate(): Promise<RedisConnection> {
		return new FakeConnection();
	}
	public async connect(): Promise<void> {}
	public close(): void {
		this.closed = true;
	}
}

describe('RedisConnection', () => {
	let app: TestingApp | undefined;

	afterEach(async () => {
		await app?.shutdown();
		app = undefined;
	});

	it('RedisModule with a custom client factory hands that connection to Redis.getConnection and closes it on destroy', async () => {
		const fake = new FakeConnection();
		app = await Application.testing({
			modules: [
				RedisModule.with({
					default: 'main',
					client: () => fake,
					connections: { main: { url: 'redis://main:6379' } }
				})
			]
		});

		await app.get('redis.connection.main');
		expect(Redis.getConnection('main')).toBe(fake);
		expect(fake.closed).toBe(false);

		await app.shutdown();
		app = undefined;
		expect(fake.closed).toBe(true);
	});
});
