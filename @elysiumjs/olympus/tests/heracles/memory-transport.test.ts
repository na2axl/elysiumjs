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

import { afterEach, describe, expect, it } from 'bun:test';

import { Heracles } from '../../src/heracles/heracles';
import { HeraclesModule } from '../../src/heracles/heracles.module';
import { Job, JobStatus } from '../../src/heracles/job';
import { Queue } from '../../src/heracles/queue';
import { MemoryTransport } from '../../src/heracles/transports/memory.transport';
import { Application, Module, Service } from '../../src/index';

const runs: string[] = [];
let failuresLeft = 0;

@Service.register({ global: false })
class Mailbox {
	public readonly sent: string[] = [];
}

@Job.register({ name: 'MemorySendJob' })
class SendJob extends Job {
	constructor(public readonly to: string) {
		super();
	}

	protected async execute(@Service.inject(Mailbox) mailbox: Mailbox): Promise<void> {
		runs.push(this.to);
		if (failuresLeft > 0) {
			failuresLeft--;
			throw new Error('smtp down');
		}
		mailbox.sent.push(this.to);
	}
}

@Job.register({ name: 'MemoryBrokenJob' })
class BrokenJob extends Job {
	constructor() {
		super();
		throw new Error('cannot build');
	}

	protected async execute(): Promise<void> {}
}

@Module.register({ services: [Mailbox], jobs: [SendJob, BrokenJob] })
class MailModule extends Module {}

describe('MemoryTransport', () => {
	let app: Awaited<ReturnType<typeof Application.testing>> | undefined;

	const boot = async (queue: { maxRetries?: number; retryDelay?: number } = {}) => {
		app = await Application.testing({
			modules: [
				HeraclesModule.with({ queues: { default: { transport: MemoryTransport, ...queue } } }),
				MailModule
			],
			boot: 'eager'
		});
	};

	afterEach(async () => {
		await app?.shutdown();
		app = undefined;
		runs.length = 0;
		failuresLeft = 0;
	});

	it('runs a dispatched job in the process, in its module', async () => {
		await boot();
		const id = await Heracles.dispatch(SendJob, ['ada@example.com']);
		await MemoryTransport.settled();
		expect(runs).toEqual(['ada@example.com']);
		const status = await Queue.get('default').getJobStatus(id);
		expect(status?.status).toBe(JobStatus.COMPLETED);
	});

	it('retries a failed job within its maxRetries', async () => {
		await boot();
		failuresLeft = 2;
		await Heracles.dispatch(SendJob, ['bob@example.com'], { maxRetries: 2, retryDelay: 1 });
		await MemoryTransport.settled();
		expect(runs).toEqual(['bob@example.com', 'bob@example.com', 'bob@example.com']);
	});

	it('marks a job failed once its retries are spent', async () => {
		await boot();
		failuresLeft = 5;
		const id = await Heracles.dispatch(SendJob, ['eve@example.com'], {
			maxRetries: 1,
			retryDelay: 1
		});
		await MemoryTransport.settled();
		expect(runs.length).toBe(2);
		const status = await Queue.get('default').getJobStatus(id);
		expect(status?.status).toBe(JobStatus.FAILED);
		expect(status?.error).toBe('smtp down');
	});

	it('waits for the time of a scheduled job, and cancels it before it runs', async () => {
		await boot();
		const later = new Date(Date.now() + 30);
		await Heracles.dispatch(SendJob, ['late@example.com'], { scheduledFor: later });
		const cancelled = await Heracles.dispatch(SendJob, ['never@example.com'], {
			scheduledFor: new Date(Date.now() + 30)
		});
		await Queue.get('default').cancelJob(cancelled);
		expect(runs).toEqual([]);
		await MemoryTransport.settled();
		expect(runs).toEqual(['late@example.com']);
		const status = await Queue.get('default').getJobStatus(cancelled);
		expect(status?.status).toBe(JobStatus.CANCELLED);
	});

	it('falls back to the retries of the queue', async () => {
		await boot({ maxRetries: 1, retryDelay: 1 });
		failuresLeft = 1;
		const id = await Heracles.dispatch(SendJob, ['queue@example.com']);
		await MemoryTransport.settled();
		expect(runs).toEqual(['queue@example.com', 'queue@example.com']);
		expect((await Queue.get('default').getJobStatus(id))?.status).toBe(JobStatus.COMPLETED);
	});

	it('fails a job that no module registers', async () => {
		await boot();
		const id = await Queue.get('default').dispatch(SendJob, 'MemoryUnknownJob', ['x@example.com']);
		await MemoryTransport.settled();
		expect(runs).toEqual([]);
		const status = await Queue.get('default').getJobStatus(id);
		expect(status?.status).toBe(JobStatus.FAILED);
		expect(status?.error).toContain('MemoryUnknownJob');
	});

	it('fails a job whose constructor throws, and keeps running others', async () => {
		await boot();
		const broken = await Heracles.dispatch(BrokenJob, []);
		await Heracles.dispatch(SendJob, ['ok@example.com']);
		await MemoryTransport.settled();
		const status = await Queue.get('default').getJobStatus(broken);
		expect(status?.status).toBe(JobStatus.FAILED);
		expect(status?.error).toBe('cannot build');
		expect(runs).toEqual(['ok@example.com']);
	});

	it('cancels every waiting job of a queue', async () => {
		await boot();
		const later = () => ({ scheduledFor: new Date(Date.now() + 1000) });
		const first = await Heracles.dispatch(SendJob, ['a@example.com'], later());
		const second = await Heracles.dispatch(SendJob, ['b@example.com'], later());
		await Queue.get('default').cancelAllJobs();
		await MemoryTransport.settled();
		expect(runs).toEqual([]);
		expect((await Queue.get('default').getJobStatus(first))?.status).toBe(JobStatus.CANCELLED);
		expect((await Queue.get('default').getJobStatus(second))?.status).toBe(JobStatus.CANCELLED);
	});

	it('holds waiting jobs while stopped and runs them on start', async () => {
		const transport = new MemoryTransport();
		const results: string[] = [];
		transport.onMessage((message) => {
			if (message.type === 'job:result') results.push(message.status);
		});
		transport.send({
			type: 'job:process',
			job: 'MemorySendJob',
			jobId: 'held',
			dispatchId: 'd-1',
			args: ['held@example.com'],
			queue: 'default',
			options: { scheduledFor: new Date(Date.now() + 20).toISOString() }
		});
		transport.stop();
		await new Promise((resolve) => setTimeout(resolve, 40));
		expect(results).toEqual([]);
		expect((await transport.getJobStatus('held', 'd-1', 'default')).status).toBe(JobStatus.PENDING);
		transport.start();
		await MemoryTransport.settled();
		expect(results.length).toBe(1);
	});
});
