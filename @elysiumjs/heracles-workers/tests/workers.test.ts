// Copyright (c) 2026-present Workbud Technologies Inc. All rights reserved.
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

import type { TransportProcessMessage } from '@elysiumjs/heracles';
import type { WorkersExecutionContext, WorkersMessageBatch } from '@elysiumjs/runtime-workers';

import { Application, Http, Module, Service } from '@elysiumjs/core';
import { Heracles, HeraclesModule, Job, Schedule } from '@elysiumjs/heracles';
import { createRuntime, createWorker } from '@elysiumjs/runtime-workers';
import { beforeEach, describe, expect, it } from 'bun:test';

import { CloudflareQueueTransport, HeraclesWorkersModule } from '../src';

const ran: string[] = [];

@Job.register({ name: 'greet', queue: 'jobs', maxRetries: 2, retryDelay: 30_000 })
@Schedule('*/5 * * * *', { args: ['cron'] })
class GreetJob extends Job {
	constructor(private readonly who: string) {
		super();
	}

	protected async execute(): Promise<void> {
		if (this.who === 'fail') throw new Error('cannot greet');
		ran.push(this.who);
	}
}

@Http.controller({ path: '/greet' })
class GreetController {
	@Http.post({ path: '/:who' })
	public async greet(@Http.context() c: { params: { who: string } }) {
		await Heracles.dispatch(GreetJob, [c.params.who]);
		return { queued: true };
	}
}

@Module.register({ controllers: [GreetController], jobs: [GreetJob] })
class GreetModule extends Module {}

const ctx = (): WorkersExecutionContext => ({ waitUntil() {}, passThroughOnException() {} });

const setup = async () => {
	const sent: { body: TransportProcessMessage; options?: { delaySeconds?: number } }[] = [];
	const JOBS = {
		async send(body: TransportProcessMessage, options?: { delaySeconds?: number }) {
			sent.push({ body: structuredClone(body), options });
		}
	};

	@Application.register({
		runtime: createRuntime({ env: {} }),
		modules: [
			HeraclesModule.with({
				queues: {
					jobs: { transport: CloudflareQueueTransport, transportOptions: { binding: 'JOBS' } }
				}
			}),
			HeraclesWorkersModule,
			GreetModule
		],
		openapi: false
	})
	class App extends Application {}

	const app = new App();
	const worker = await createWorker(app);
	const env = { JOBS };
	return { app, worker, env, sent };
};

const batchOf = (bodies: unknown[], attempts = 1) => {
	const acked: number[] = [];
	const retried: { index: number; delaySeconds?: number }[] = [];
	const batch: WorkersMessageBatch = {
		queue: 'jobs',
		messages: bodies.map((body, index) => ({
			id: String(index),
			timestamp: new Date(0),
			body,
			attempts,
			ack: () => void acked.push(index),
			retry: (options) => void retried.push({ index, delaySeconds: options?.delaySeconds })
		})),
		ackAll() {},
		retryAll() {}
	};
	return { batch, acked, retried };
};

describe('Heracles on Cloudflare Workers', () => {
	beforeEach(() => Service.clear());

	it('sends dispatched jobs to the queue binding, and runs them from the queue', async () => {
		const { app, worker, env, sent } = await setup();
		ran.length = 0;

		const response = await worker.fetch(
			new Request('http://localhost/greet/ada', { method: 'POST' }),
			env,
			ctx()
		);
		expect(response.status).toBe(200);
		expect(sent).toHaveLength(1);
		expect(sent[0]!.body).toMatchObject({ type: 'job:process', queue: 'jobs', args: ['ada'] });

		const { batch, acked } = batchOf([sent[0]!.body, { other: 'message' }]);
		await worker.queue(batch, env, ctx());
		expect(ran).toEqual(['ada']);
		expect(acked).toEqual([0, 1]);
		await app.kernel.shutdown();
	});

	it('retries a failed job after its delay, then gives up after its last retry', async () => {
		const { app, worker, env, sent } = await setup();
		await worker.fetch(new Request('http://localhost/greet/fail', { method: 'POST' }), env, ctx());
		const message = sent[0]!.body;

		const first = batchOf([message], 1);
		await worker.queue(first.batch, env, ctx());
		expect(first.retried).toEqual([{ index: 0, delaySeconds: 30 }]);
		expect(first.acked).toEqual([]);

		const last = batchOf([message], 3);
		await worker.queue(last.batch, env, ctx());
		expect(last.retried).toEqual([]);
		expect(last.acked).toEqual([0]);
		await app.kernel.shutdown();
	});

	it('dispatches the scheduled jobs of a cron trigger', async () => {
		const { app, worker, env, sent } = await setup();
		await worker.scheduled({ scheduledTime: 0, cron: '*/5 * * * *', noRetry() {} }, env, ctx());
		await worker.scheduled({ scheduledTime: 0, cron: '0 0 * * *', noRetry() {} }, env, ctx());

		expect(sent.map(({ body }) => body.args)).toEqual([['cron']]);
		await app.kernel.shutdown();
	});
});
