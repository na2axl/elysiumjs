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

import { Application, Module, Service } from '@elysiumjs/core';
import { afterEach, describe, expect, it, spyOn } from 'bun:test';

import { HeraclesWorkCommand } from '../src/commands';
import { HeraclesModule } from '../src/heracles.module';
import { Job } from '../src/job';
import { Queue } from '../src/queue';
import { DuplicateJobError, JobRegistry } from '../src/registry';
import { RedisWorker } from '../src/workers/redis.worker';

@Service.register({ global: false })
class Secret {
	public readonly value = 'module-private';
}

let seen: string | undefined;

@Job.register({ name: 'SendInvoiceJob' })
class SendInvoiceJob extends Job {
	protected async execute(): Promise<void> {
		seen = Service.get<Secret>(Secret)?.value;
	}
}

const makeDuplicate = () => {
	@Job.register({ name: 'SendInvoiceJob' })
	class OtherInvoiceJob extends Job {
		protected async execute(): Promise<void> {}
	}
	return OtherInvoiceJob;
};

@Module.register({ services: [Secret], jobs: [SendInvoiceJob] })
class BillingModule extends Module {}

@Module.register({ jobs: [makeDuplicate()] })
class LegacyModule extends Module {}

class StubTransport {
	constructor(_mode: unknown, _options?: unknown) {}
	public onMessage(_handler: unknown): void {}
}

const JOB = 'elysium.heracles.job.SendInvoiceJob';

describe('HeraclesModule', () => {
	let app: Awaited<ReturnType<typeof Application.testing>> | undefined;

	afterEach(async () => {
		await app?.shutdown();
		app = undefined;
	});

	it('registers nothing at import time', async () => {
		const proc = Bun.spawn(
			[
				'bun',
				'-e',
				"import { Service } from '@elysiumjs/core'; await import('./src/index.ts'); console.log(JSON.stringify(Service.keys('*')))"
			],
			{ cwd: `${import.meta.dir}/..`, stdout: 'pipe', stderr: 'pipe' }
		);
		const out = await new Response(proc.stdout).text();
		await proc.exited;
		expect(JSON.parse(out.trim().split('\n').pop()!)).toEqual([]);
	});

	it('does not register a decorated job class as a service', () => {
		const instance = spyOn(Service, 'instance');

		@Job.register({ name: 'NoSideEffectJob' })
		class NoSideEffectJob extends Job {
			protected async execute(): Promise<void> {}
		}

		expect(NoSideEffectJob).toBeDefined();
		expect(instance).not.toHaveBeenCalled();
		expect(Service.keys('elysium.heracles.job.*')).toEqual([]);
		instance.mockRestore();
	});

	it('collects jobs declared by loaded modules with their owner', async () => {
		app = await Application.testing({
			modules: [HeraclesModule, BillingModule],
			boot: 'eager'
		});
		const entry = JobRegistry.get(JOB);
		expect(entry?.jobClass).toBe(SendInvoiceJob);
		expect(entry?.module.moduleClass).toBe(BillingModule);
		expect(JobRegistry.all().map((e) => e.jobClass)).toContain(SendInvoiceJob);
	});

	it('ignores job classes without heracles metadata', async () => {
		class Plain {}

		@Module.register({ jobs: [Plain] })
		class PlainModule extends Module {}

		app = await Application.testing({ modules: [HeraclesModule, PlainModule], boot: 'eager' });
		expect(JobRegistry.all()).toEqual([]);
	});

	it('throws DuplicateJobError naming both modules', async () => {
		const error = await Application.testing({
			modules: [HeraclesModule, BillingModule, LegacyModule],
			boot: 'eager'
		}).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(DuplicateJobError);
		const duplicate = error as DuplicateJobError;
		expect([...duplicate.modules].sort()).toEqual(['BillingModule', 'LegacyModule']);
		expect(duplicate.message).toContain('BillingModule');
		expect(duplicate.message).toContain('LegacyModule');
	});

	it('creates the configured queues', async () => {
		app = await Application.testing({
			modules: [HeraclesModule.with({ queues: { 'module-test-q': { transport: StubTransport as any } } })],
			boot: 'eager'
		});
		expect(Queue.exists('module-test-q')).toBe(true);
	});

	it('clears the registry on destroy', async () => {
		app = await Application.testing({
			modules: [HeraclesModule, BillingModule],
			boot: 'eager'
		});
		expect(JobRegistry.get(JOB)).toBeDefined();
		await app.shutdown();
		app = undefined;
		expect(JobRegistry.get(JOB)).toBeUndefined();
	});

	it('runs a job inside its owning module context', async () => {
		app = await Application.testing({
			modules: [HeraclesModule, BillingModule],
			boot: 'eager'
		});
		seen = undefined;
		const worker = new RedisWorker('default', { id: 'w1' }) as any;
		let queued: Job | undefined;
		worker.sendJobStatusUpdate = async () => {};
		worker.addJob = async (job: Job) => {
			queued = job;
		};
		await worker.handleProcessJob('job_1', 'dispatch_1', JOB, [], 'default', {});
		expect(queued).toBeDefined();
		await queued!.run();
		expect(seen).toBe('module-private');
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
