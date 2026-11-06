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

import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

/**
 * W4: singletons boot inside the first invocation. Each request below goes through the `SELF`
 * binding, so it is an invocation of its own, as in production.
 *
 * workerd binds an I/O object (a stream, a request or response body, a socket) to the request
 * being handled when it was created, whatever the AsyncLocalStorage context: booting outside the
 * invocation's context does not change that. A singleton may do I/O in `onInit` and keep what it
 * read; it cannot keep the I/O object itself for later invocations.
 */
describe('I/O context of singletons booted by the first invocation (W4)', () => {
	it('serves later invocations from what a singleton read in its onInit', async () => {
		const first = await SELF.fetch('http://self/io/feed');
		expect(first.status).toBe(200);
		expect(await first.json()).toEqual({ first: 'one', boots: 1 });

		const second = await SELF.fetch('http://self/io/feed');
		expect(second.status).toBe(200);
		expect(await second.json()).toEqual({ first: 'one', boots: 1 });
	});

	it('cannot use, from a later invocation, a stream a singleton kept open', async () => {
		// Boots the app, if the test above did not, in an invocation of its own.
		await (await SELF.fetch('http://self/io/feed')).arrayBuffer();

		const response = await SELF.fetch('http://self/io/next');

		expect(response.status).toBe(200);
		const { error } = (await response.json()) as { error?: string };
		expect(error).toMatch(/^Cannot perform I\/O on behalf of a different request/);
	});
});
