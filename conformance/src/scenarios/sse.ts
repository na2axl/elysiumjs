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

import type { Scenario } from './types';

import { Application, Http, Module, Service, ServiceScope } from '@elysiumjs/core';

import { waitFor } from './wait';

const make = async (): Promise<Application> => {
	let counter = 0;

	@Http.controller('/stream')
	class StreamController {
		@Http.sse()
		public events() {
			return `tick ${++counter}`;
		}
	}

	@Module.register({ controllers: [StreamController] })
	class StreamModule extends Module {}

	@Application.register({ modules: [StreamModule], openapi: false })
	class StreamApp extends Application {}

	return new StreamApp();
};

/**
 * A server-sent events route streams events. The expected `text` is the first two events.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export const sse: Scenario = {
	name: 'sse: two events read from a streamed body',
	app: make,
	requests: [
		{
			request: () => new Request('http://localhost/stream'),
			expect: {
				status: 200,
				headers: { 'content-type': 'text/event-stream' },
				text: 'data: tick 1\n\ndata: tick 2\n\n'
			}
		}
	]
};

let destroyed = 0;

const makeDisposal = async (): Promise<Application> => {
	destroyed = 0;
	let counter = 0;

	@Service.register({ scope: ServiceScope.REQUEST })
	class StreamSession {
		public onDestroy() {
			destroyed++;
		}
	}

	@Http.controller('/stream')
	class StreamController {
		@Http.sse()
		public events(@Service.inject(StreamSession) session: StreamSession) {
			return `tick ${++counter} ${session ? 'open' : 'none'} destroyed ${destroyed}`;
		}
	}

	@Module.register({ services: [StreamSession], controllers: [StreamController] })
	class StreamModule extends Module {}

	@Application.register({ modules: [StreamModule], openapi: false })
	class StreamApp extends Application {}

	return new StreamApp();
};

/**
 * The request scope of a streamed response lives as long as its body: nothing is disposed while
 * events are sent, and the scope is disposed once, after the client cancels the stream.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export const sseDisposal: Scenario = {
	name: 'sse: the request scope is disposed when the stream ends',
	app: makeDisposal,
	requests: [
		{
			request: () => new Request('http://localhost/stream'),
			expect: {
				status: 200,
				headers: { 'content-type': 'text/event-stream' },
				text: 'data: tick 1 open destroyed 0\n\ndata: tick 2 open destroyed 0\n\n'
			}
		}
	],
	after: async (_app, assert) => {
		await waitFor(() => destroyed >= 1);
		// Leave time for a second, wrong, disposal to show up.
		await new Promise<void>((resolve) => setTimeout(resolve, 50));
		assert.equal(destroyed, 1, 'request scope disposed once after the stream');
	}
};
