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

/**
 * A Worker built from an Elysium app, for the wrangler gate: a route sends to a queue, the
 * queue consumer and a cron handler write to a KV-backed cache, and routes read it back.
 */

import type { WorkersMessageBatch, WorkersScheduledController } from '../../src/index';

import {
	Application,
	Http,
	HttpControllerScope,
	Module,
	Service,
	ServiceScope,
	t
} from '@elysiumjs/olympus';
import { Cache, MnemosyneModule } from '@elysiumjs/olympus/mnemosyne';

import {
	createRuntime,
	createWorker,
	KeyvWorkersKV,
	Workers,
	WorkersModule
} from '../../src/index';

type Job = { id: string };

/** The JOBS queue producer of the current invocation. */
@Service.register({ scope: ServiceScope.REQUEST })
class JobQueue {
	public constructor(
		@Workers.inject('JOBS') private readonly queue: { send(body: Job): Promise<void> }
	) {}

	public send(job: Job) {
		return this.queue.send(job);
	}
}

@Service.register()
class JobConsumer {
	@Workers.queue('elysium-jobs')
	public async handle(batch: WorkersMessageBatch<Job>) {
		for (const message of batch.messages) {
			await Cache.store('kv').set(`job:${message.body.id}`, 'done');
			message.ack();
		}
	}

	@Workers.cron('*/5 * * * *')
	public async tick(controller: WorkersScheduledController) {
		await Cache.store('kv').set('cron', controller.cron);
	}
}

@Http.controller('/jobs', { scope: HttpControllerScope.REQUEST })
class JobController {
	public constructor(@Service.inject(JobQueue) private readonly jobs: JobQueue) {}

	@Http.post('/:id')
	public async create(@Http.param('id', t.String({ minLength: 2 })) id: string) {
		await this.jobs.send({ id });
		return { queued: id };
	}

	@Http.get('/:id')
	public async show(@Http.param('id', t.String()) id: string) {
		return { id, status: (await Cache.store('kv').get<string>(`job:${id}`)) ?? 'pending' };
	}
}

@Http.controller('/cron')
class CronController {
	@Http.get()
	public async last() {
		return { cron: (await Cache.store('kv').get<string>('cron')) ?? null };
	}
}

@Module.register({
	services: [JobQueue, JobConsumer],
	controllers: [JobController, CronController]
})
class JobsModule extends Module {}

@Application.register({
	runtime: createRuntime(),
	modules: [
		WorkersModule.with({ bindings: ['JOBS'] }),
		MnemosyneModule.with({
			cache: {
				memory: false,
				stores: { kv: () => new KeyvWorkersKV({ binding: 'CACHE' }) }
			}
		}),
		JobsModule
	],
	openapi: false
})
class App extends Application {}

const worker = await createWorker(new App());

// The root Elysia app, for elysia/plugin/aot.
export const app = worker.app;

export default worker;
