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

import { Application, Http, Module } from '@elysiumjs/core';

const make = async (): Promise<Application> => {
	let counter = 0;

	@Http.controller({ path: '/stream' })
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
