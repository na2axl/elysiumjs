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

/**
 * The Worker the workerd lane runs as `main` (see `wrangler.jsonc`), reached through its `SELF`
 * service binding so that each request is an invocation of its own.
 *
 * W4: the `Feed` singleton opens an I/O object in its `onInit`, during the first invocation: a
 * subrequest to `/io/source`, whose streamed body it keeps open. `/io/feed` serves what it read
 * at boot; `/io/next` reads the next chunk of the kept stream.
 */

import type { WorkersExecutionContext } from '@elysiumjs/runtime-workers';

import { Application, Http, Module, Service } from '@elysiumjs/core';
import { createRuntime, createWorker, Workers } from '@elysiumjs/runtime-workers';

const SOURCE_DELAY_MS = 50;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

type Fetcher = { fetch(input: string): Promise<Response> };

/**
 * A streamed body: one chunk now, the second one later, then the end. It is served outside the
 * app: the app holds every request until it booted, and the boot waits for this response.
 */
const source = (): Response => {
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(encoder.encode('one'));
			setTimeout(() => {
				controller.enqueue(encoder.encode('two'));
				controller.close();
			}, SOURCE_DELAY_MS);
		}
	});
	return new Response(body, { headers: { 'content-type': 'text/plain' } });
};

@Service.register({ name: 'conformance.feed' })
class Feed {
	public first = '';
	public boots = 0;
	private reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

	public async onInit() {
		this.boots++;
		const response = await Workers.binding<Fetcher>('SELF').fetch('http://self/io/source');
		this.reader = response.body!.getReader();
		const { value } = await this.reader.read();
		this.first = decoder.decode(value);
	}

	/** Reads the next chunk of the stream opened at boot. */
	public async next(): Promise<string> {
		const { value, done } = await this.reader!.read();
		return done ? '' : decoder.decode(value);
	}
}

@Http.controller('/io')
class IoController {
	@Http.get('/feed')
	public feed(@Service.inject('conformance.feed') feed: Feed) {
		return { first: feed.first, boots: feed.boots };
	}

	@Http.get('/next')
	public async next(@Service.inject('conformance.feed') feed: Feed) {
		try {
			return { chunk: await feed.next() };
		} catch (error) {
			return { error: error instanceof Error ? error.message : String(error) };
		}
	}
}

@Module.register({ services: [Feed], controllers: [IoController] })
class IoModule extends Module {}

@Application.register({ runtime: createRuntime(), modules: [IoModule], openapi: false })
class IoApp extends Application {}

// Built on the first request, not on import: the test files share this isolate and its
// service container, and build apps of their own.
let worker: ReturnType<typeof createWorker> | undefined;

/** The flow store Durable Object, which `tests/workerd/flow-store.test.ts` drives through `FLOWS`. */
export { FlowStoreObject } from '@elysiumjs/ariadne-workers';

export default {
	async fetch(request: Request, env: Record<string, unknown>, ctx: WorkersExecutionContext) {
		if (new URL(request.url).pathname === '/io/source') return source();
		worker ??= createWorker(new IoApp());
		return (await worker).fetch(request, env, ctx);
	}
};
