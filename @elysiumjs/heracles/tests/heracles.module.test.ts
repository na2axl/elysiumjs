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
import { Heracles } from '../src/heracles';
import { Job } from '../src/job';
import { Queue } from '../src/queue';
import { DuplicateJobError, JobRegistry, QUEUES_SERVICE } from '../src/registry';
import { RedisTransport } from '../src/transports/redis.transport';
import { RedisWorker } from '../src/workers/redis.worker';

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
	public async stop(): Promise<void> {}
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
		const [out, err, code] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited
		]);
		if (code !== 0) throw new Error(`import check exited with ${code}: ${err}`);
		expect(code).toBe(0);
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
		await app.get(QUEUES_SERVICE);
		expect(Queue.exists('module-test-q')).toBe(true);
		await app.shutdown();
		app = undefined;
		expect(Queue.exists('module-test-q')).toBe(false);
	});

	it('shuts down cleanly with a real RedisTransport queue that was never started', async () => {
		app = await Application.testing({
			modules: [
				HeraclesModule.with({
					queues: { 'never-started': { transport: RedisTransport as any } }
				})
			]
		});
		await app.get(QUEUES_SERVICE);
		expect(Queue.exists('never-started')).toBe(true);
		const errors = spyOn(console, 'error').mockImplementation(() => {});
		await app.shutdown();
		app = undefined;
		const logged = errors.mock.calls.length;
		errors.mockRestore();
		expect(logged).toBe(0);
		expect(Queue.exists('never-started')).toBe(false);
	});

	it('stops and removes every queue even when one stop throws', async () => {
		const stopped: string[] = [];
		const make = (fail: boolean) =>
			class {
				constructor(_mode: unknown, _options?: unknown) {}
				public onMessage(_handler: unknown): void {}
				public async stop(): Promise<void> {
					if (fail) throw new Error('stop failed');
					stopped.push('ok');
				}
			};
		app = await Application.testing({
			modules: [
				HeraclesModule.with({
					queues: {
						'qa-bad': { transport: make(true) as any },
						'qa-good': { transport: make(false) as any }
					}
				})
			]
		});
		await app.get(QUEUES_SERVICE);
		const errors = spyOn(console, 'error').mockImplementation(() => {});
		await app.shutdown();
		app = undefined;
		errors.mockRestore();
		expect(stopped).toEqual(['ok']);
		expect(Queue.exists('qa-bad')).toBe(false);
		expect(Queue.exists('qa-good')).toBe(false);
	});

	it('lets a module that does not import HeraclesModule dispatch on a lazy boot', async () => {
		const sent: unknown[] = [];
		class SendingTransport {
			constructor(_mode: unknown, _options?: unknown) {}
			public onMessage(_handler: unknown): void {}
			public async start(): Promise<void> {}
			public async send(event: unknown): Promise<void> {
				sent.push(event);
			}
			public async stop(): Promise<void> {}
		}

		@Module.register({ jobs: [SendInvoiceJob], services: [Secret] })
		class UserModule extends Module {}

		app = await Application.testing({
			modules: [
				UserModule,
				HeraclesModule.with({
					queues: { default: { transport: SendingTransport as any } }
				})
			]
		});
		expect(Queue.exists('default')).toBe(false);
		await Heracles.dispatch(SendInvoiceJob, []);
		expect(Queue.exists('default')).toBe(true);
		expect(JobRegistry.get(JOB)).toBeDefined();
		expect(sent.length).toBe(1);
	});

	it('starts a stopped queue exactly once for concurrent dispatches', async () => {
		let starts = 0;
		const sent: unknown[] = [];
		class CountingTransport {
			constructor(_mode: unknown, _options?: unknown) {}
			public onMessage(_handler: unknown): void {}
			public async start(): Promise<void> {
				starts++;
				await new Promise((resolve) => setTimeout(resolve, 10));
			}
			public async send(event: unknown): Promise<void> {
				sent.push(event);
			}
			public async stop(): Promise<void> {}
		}

		@Module.register({ jobs: [SendInvoiceJob] })
		class UserModule extends Module {}

		app = await Application.testing({
			modules: [
				UserModule,
				HeraclesModule.with({ queues: { default: { transport: CountingTransport as any } } })
			]
		});

		await Promise.all([Heracles.dispatch(SendInvoiceJob, []), Heracles.dispatch(SendInvoiceJob, [])]);
		await Heracles.dispatch(SendInvoiceJob, []);

		expect(starts).toBe(1);
		expect(sent.length).toBe(3);
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

	it('runs a job inside its owning module context, across awaits', async () => {
		app = await Application.testing({
			modules: [HeraclesModule, BillingModule],
			boot: 'eager'
		});
		seen = undefined;
		const worker = new RedisWorker('default', { id: 'w1' }) as any;
		let queued: unknown;
		worker.sendJobStatusUpdate = async () => {};
		worker.addJob = async (job: Job) => {
			queued = { job, retries: 0 };
		};
		worker.queues.set('default', { activeJobs: new Map(), jobs: [] });
		await worker.handleProcessJob('job_1', 'dispatch_1', JOB, [], 'default', {});
		await worker.processJobInternal(queued, 'default');
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
