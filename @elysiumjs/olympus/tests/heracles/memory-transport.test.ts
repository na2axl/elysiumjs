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

@Module.register({ services: [Mailbox], jobs: [SendJob] })
class MailModule extends Module {}

describe('MemoryTransport', () => {
	let app: Awaited<ReturnType<typeof Application.testing>> | undefined;

	const boot = async () => {
		app = await Application.testing({
			modules: [
				HeraclesModule.with({ queues: { default: { transport: MemoryTransport } } }),
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
});
