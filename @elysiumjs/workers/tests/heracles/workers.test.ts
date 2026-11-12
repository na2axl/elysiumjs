// Copyright (c) 2026-present Axel Nana <ax.lnana@outlook.com>. All rights reserved.
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

import type { TransportProcessMessage } from '@elysiumjs/olympus/heracles';
import type {
	DeadJob,
	HeraclesWorkersConfig,
	WorkersExecutionContext,
	WorkersMessageBatch
} from '../../src';

import { Application, Http, Module, Service } from '@elysiumjs/olympus';
import { Heracles, HeraclesModule, Job, Scheduler } from '@elysiumjs/olympus/heracles';
import { beforeEach, describe, expect, it } from 'bun:test';

import {
	CloudflareQueueTransport,
	createRuntime,
	createWorker,
	HeraclesWorkersModule
} from '../../src';

const ran: string[] = [];

@Job.register({ name: 'greet', queue: 'jobs', maxRetries: 2, retryDelay: 30_000 })
@Scheduler.job('*/5 * * * *', { args: ['cron'] })
class GreetJob extends Job {
	constructor(private readonly who: string) {
		super();
	}

	protected async execute(): Promise<void> {
		if (this.who === 'fail') throw new Error('cannot greet');
		ran.push(this.who);
	}
}

@Job.register({ name: 'secret', queue: 'jobs', maxRetries: 1, encrypted: true })
class SecretJob extends Job {
	constructor(private readonly who: string) {
		super();
	}

	protected async execute(): Promise<void> {
		ran.push(`secret:${this.who}`);
	}
}

@Http.controller('/greet')
class GreetController {
	@Http.post('/:who')
	public async greet(@Http.context() c: { params: { who: string } }) {
		await Heracles.dispatch(GreetJob, [c.params.who]);
		return { queued: true };
	}
}

@Module.register({ controllers: [GreetController], jobs: [GreetJob, SecretJob] })
class GreetModule extends Module {}

const ctx = (): WorkersExecutionContext => ({ waitUntil() {}, passThroughOnException() {} });

const setup = async (workers?: HeraclesWorkersConfig, deadLetterQueue?: string) => {
	const sent: { body: TransportProcessMessage; options?: { delaySeconds?: number } }[] = [];
	const dead: unknown[] = [];
	const JOBS = {
		async send(body: TransportProcessMessage, options?: { delaySeconds?: number }) {
			sent.push({ body: structuredClone(body), options });
		}
	};
	const JOBS_DLQ = {
		async send(body: unknown) {
			dead.push(structuredClone(body));
		}
	};

	@Application.register({
		runtime: createRuntime({ env: {} }),
		modules: [
			HeraclesModule.with({
				queues: {
					jobs: {
						transport: CloudflareQueueTransport,
						transportOptions: { binding: 'JOBS', ...(deadLetterQueue && { deadLetterQueue }) }
					}
				}
			}),
			workers ? HeraclesWorkersModule.with(workers) : HeraclesWorkersModule,
			GreetModule
		],
		openapi: false
	})
	class App extends Application {}

	const app = new App();
	const worker = await createWorker(app);
	const env = { JOBS, JOBS_DLQ };
	return { app, worker, env, sent, dead };
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
		const { app, worker, env, sent, dead } = await setup();
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
		// Its queue sets no dead letter queue: the job is logged and dropped.
		expect(dead).toEqual([]);
		await app.kernel.shutdown();
	});

	it("sends a job that failed its last retry to its queue's dead letter queue, and to onDead", async () => {
		const buried: DeadJob[] = [];
		const { app, worker, env, sent, dead } = await setup(
			{ onDead: (job) => void buried.push(job) },
			'JOBS_DLQ'
		);
		await worker.fetch(new Request('http://localhost/greet/fail', { method: 'POST' }), env, ctx());

		const last = batchOf([sent[0]!.body], 3);
		await worker.queue(last.batch, env, ctx());
		expect(last.acked).toEqual([0]);
		expect(dead).toEqual([
			expect.objectContaining({
				type: 'job:process',
				job: sent[0]!.body.job,
				args: ['fail'],
				failure: expect.objectContaining({ error: 'cannot greet', attempts: 3 })
			})
		]);
		expect(buried).toHaveLength(1);
		expect(buried[0]).toMatchObject({ job: sent[0]!.body.job, queue: 'jobs', attempts: 3 });
		await app.kernel.shutdown();
	});

	it('retries, then buries, a job whose arguments do not decrypt, without running it', async () => {
		const buried: DeadJob[] = [];
		const { app, worker, env } = await setup({ onDead: (job) => void buried.push(job) });
		const body = {
			type: 'job:process',
			job: 'elysium.heracles.job.secret',
			jobId: 'j-1',
			dispatchId: 'd-1',
			args: ['in clear'],
			queue: 'jobs',
			options: { maxRetries: 1 }
		};

		const first = batchOf([body], 1);
		await worker.queue(first.batch, env, ctx());
		expect(first.retried).toEqual([{ index: 0, delaySeconds: undefined }]);

		const last = batchOf([body], 2);
		await worker.queue(last.batch, env, ctx());
		expect(last.acked).toEqual([0]);
		expect(buried).toHaveLength(1);
		expect((buried[0]!.error as Error).message).toContain('sent in clear');
		expect(ran).not.toContain('secret:in clear');
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
