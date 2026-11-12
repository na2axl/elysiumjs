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

import type { BackgroundScope, BackgroundWork } from '@elysiumjs/olympus';
import type { Job as JobType } from '@elysiumjs/olympus/heracles';

import { Application, Background, Module, Service } from '@elysiumjs/olympus';
import { HeraclesModule, Job } from '@elysiumjs/olympus/heracles';
import { afterEach, describe, expect, it } from 'bun:test';

import { HeraclesWorkCommand } from '../../src/heracles/commands/work.command';
import { RedisWorker } from '../../src/heracles/redis.worker';

@Service.register({ global: false })
class Secret {
	public readonly value = 'module-private';
}

let seen: string | undefined;

@Job.register({ name: 'SendInvoiceJob' })
class SendInvoiceJob extends Job {
	protected async execute(): Promise<void> {
		await Bun.sleep(0);
		seen = Service.get<Secret>(Secret)?.value;
	}
}

@Module.register({ services: [Secret], jobs: [SendInvoiceJob] })
class BillingModule extends Module {}

const scoped: string[] = [];

@Background.scope()
class TraceScope implements BackgroundScope {
	public async run<T>(work: BackgroundWork, next: () => Promise<T>): Promise<T> {
		scoped.push(`${work.kind}:${work.name}`);
		return next();
	}
}

@Job.register({ name: 'ChargeJob' })
class ChargeJob extends Job {
	constructor(public readonly amount: number) {
		super();
	}

	protected async execute(@Service.inject(Secret) secret: Secret): Promise<void> {
		seen = `${secret.value}:${this.amount}`;
	}
}

@Module.register({ services: [Secret, TraceScope], jobs: [ChargeJob] })
class ChargesModule extends Module {}

const JOB = 'elysium.heracles.job.SendInvoiceJob';

describe('RedisWorker', () => {
	let app: Awaited<ReturnType<typeof Application.testing>> | undefined;

	afterEach(async () => {
		await app?.shutdown();
		app = undefined;
	});

	it('runs a job inside its owning module context, across awaits', async () => {
		app = await Application.testing({
			modules: [HeraclesModule, BillingModule],
			boot: 'eager'
		});
		seen = undefined;
		const worker = new RedisWorker('default', { id: 'w1' }) as any;
		let queued: unknown;
		worker.sendJobStatusUpdate = async () => {};
		worker.addJob = async (job: JobType) => {
			queued = { job, retries: 0 };
		};
		worker.queues.set('default', { activeJobs: new Map(), jobs: [] });
		await worker.handleProcessJob('job_1', 'dispatch_1', JOB, [], 'default', {});
		await worker.processJobInternal(queued, 'default');
		expect(seen).toBe('module-private');
	});

	it('injects services in execute() and runs the job in the background scopes', async () => {
		app = await Application.testing({
			modules: [HeraclesModule, ChargesModule],
			boot: 'eager'
		});
		seen = undefined;
		scoped.length = 0;
		const worker = new RedisWorker('default', { id: 'w3' }) as any;
		let queued: unknown;
		worker.sendJobStatusUpdate = async () => {};
		worker.addJob = async (job: JobType) => {
			queued = { job, retries: 0 };
		};
		worker.queues.set('default', { activeJobs: new Map(), jobs: [] });
		await worker.handleProcessJob(
			'job_2',
			'dispatch_2',
			'elysium.heracles.job.ChargeJob',
			[42],
			'default',
			{}
		);
		await worker.processJobInternal(queued, 'default');
		expect(seen).toBe('module-private:42');
		expect(scoped).toEqual(['job:ChargeJob']);
	});

	it('reports an unknown job as failed', async () => {
		app = await Application.testing({ modules: [HeraclesModule], boot: 'eager' });
		const worker = new RedisWorker('default', { id: 'w2' }) as any;
		const calls: unknown[][] = [];
		worker.sendJobStatusUpdate = async (...args: unknown[]) => {
			calls.push(args);
		};
		await worker.handleProcessJob('j', 'd', JOB, [], 'default', {});
		expect(calls.at(-1)?.[3]).toBe('failed');
	});

	it('boots the whole app before the work command runs', () => {
		expect(HeraclesWorkCommand.boot).toBe(true);
	});
});
