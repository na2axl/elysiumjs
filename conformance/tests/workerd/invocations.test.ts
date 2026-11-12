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

import type { WorkersMessageBatch } from '@elysiumjs/runtime-workers';

import {
	Application,
	Http,
	Module,
	resetContainer,
	Runtime,
	Service,
	ServiceScope
} from '@elysiumjs/olympus';
import { createWorker, runtime as runtimeWorkers, Workers } from '@elysiumjs/runtime-workers';
import {
	createExecutionContext,
	createMessageBatch,
	env,
	getQueueResult,
	waitOnExecutionContext
} from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const DESTROY_DELAY_MS = 20;

let app: Application | undefined;

beforeEach(() => {
	Runtime.use(runtimeWorkers);
});

afterEach(async () => {
	await app?.kernel.shutdown();
	app = undefined;
	resetContainer();
});

describe('request scope disposal under waitUntil', () => {
	it('keeps the invocation alive until an async onDestroy has finished', async () => {
		const destroyed: string[] = [];

		@Service.register({ scope: ServiceScope.REQUEST })
		class SlowSession {
			public async onDestroy() {
				await new Promise<void>((resolve) => setTimeout(resolve, DESTROY_DELAY_MS));
				destroyed.push('SlowSession');
			}
		}

		@Http.controller('/slow')
		class SlowController {
			@Http.get()
			public show(@Service.inject(SlowSession) session: SlowSession) {
				return { ok: !!session };
			}
		}

		@Module.register({ services: [SlowSession], controllers: [SlowController] })
		class SlowModule extends Module {}

		@Application.register({ modules: [SlowModule], openapi: false })
		class SlowApp extends Application {}

		app = new SlowApp();
		const worker = await createWorker(app);
		const ctx = createExecutionContext();

		const response = await worker.fetch(new Request('http://localhost/slow'), env, ctx);
		expect(await response.json()).toEqual({ ok: true });
		await waitOnExecutionContext(ctx);

		expect(destroyed).toEqual(['SlowSession']);
	});
});

describe('queue batches', () => {
	it('retries only the message an each handler failed on and acks the others', async () => {
		const handled: string[] = [];

		@Service.register()
		class JobConsumer {
			@Workers.queue('jobs', { each: true })
			public handle(message: WorkersMessageBatch<string>['messages'][number]) {
				if (message.body === 'bad') throw new Error('bad job');
				handled.push(message.body);
			}
		}

		@Module.register({ services: [JobConsumer] })
		class JobsModule extends Module {}

		@Application.register({ modules: [JobsModule], openapi: false })
		class JobsApp extends Application {}

		app = new JobsApp();
		const worker = await createWorker(app);
		const batch = createMessageBatch<string>('jobs', [
			{ id: 'm1', timestamp: Date.now(), attempts: 1, body: 'first' },
			{ id: 'm2', timestamp: Date.now(), attempts: 1, body: 'bad' },
			{ id: 'm3', timestamp: Date.now(), attempts: 1, body: 'third' }
		]);
		const ctx = createExecutionContext();

		await worker.queue(batch, env, ctx);
		const result = await getQueueResult(batch, ctx);

		expect(handled).toEqual(['first', 'third']);
		expect(result.ackAll).toBe(false);
		expect(result.retryBatch.retry).toBe(false);
		expect([...result.explicitAcks].sort()).toEqual(['m1', 'm3']);
		expect(result.retryMessages.map((message: { msgId: string }) => message.msgId)).toEqual(['m2']);
	});
});
