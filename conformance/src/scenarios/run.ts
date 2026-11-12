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

import type { Application } from '@elysiumjs/core';
import type { AssertAdapter, Scenario, ScenarioDriver } from './types';

import { createHttpClient, resetContainer, Runtime } from '@elysiumjs/core';

const EVENT_COUNT = 2;

/** Reads the first events of a server-sent events body, then cancels the stream. */
const readEvents = async (response: Response): Promise<string> => {
	const reader = response.body!.getReader();
	const decoder = new TextDecoder();
	let text = '';
	while ((text.match(/\n\n/g) ?? []).length < EVENT_COUNT) {
		const { done, value } = await reader.read();
		if (done) break;
		text += decoder.decode(value, { stream: true });
	}
	await reader.cancel();
	return text.split('\n\n').slice(0, EVENT_COUNT).join('\n\n') + '\n\n';
};

/** Asserts the status, headers and body of one response, and returns its JSON body, if any. */
const checkResponse = async (
	response: Response,
	expect: Scenario['requests'][number]['expect'],
	label: string,
	assert: AssertAdapter
): Promise<unknown> => {
	assert.equal(response.status, expect.status, `${label}: status`);
	for (const [name, value] of Object.entries(expect.headers ?? {})) {
		const actual = response.headers.get(name) ?? '';
		assert.equal(actual.startsWith(value), true, `${label}: header ${name} (${actual})`);
	}
	const streamed = (response.headers.get('content-type') ?? '').startsWith('text/event-stream');
	if (streamed) {
		const text = await readEvents(response);
		if (expect.text !== undefined) assert.equal(text, expect.text, `${label}: text`);
	} else if (expect.json !== undefined || expect.includes !== undefined) {
		const json = (await response.json()) as Record<string, unknown>;
		if (expect.json !== undefined) {
			assert.equal(JSON.stringify(json), JSON.stringify(expect.json), `${label}: json`);
		}
		for (const [key, value] of Object.entries(expect.includes ?? {})) {
			assert.equal(JSON.stringify(json[key]), JSON.stringify(value), `${label}: json ${key}`);
		}
		return json;
	} else if (expect.text !== undefined) {
		assert.equal(await response.text(), expect.text, `${label}: text`);
	} else {
		await response.arrayBuffer();
	}
};

/**
 * Sends a scenario's requests through `handle` and asserts each response.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @param s The scenario.
 * @param handle How a request reaches the app.
 * @param assert The assertion adapter of the test framework.
 */
export const checkRequests = async (
	s: Scenario,
	handle: (request: Request) => Promise<Response>,
	assert: AssertAdapter
): Promise<void> => {
	const previous: unknown[] = [];
	for (const [index, { request, expect }] of s.requests.entries()) {
		const response = await handle(request(previous));
		previous.push(await checkResponse(response, expect, `${s.name} #${index + 1}`, assert));
	}
};

/** The default driver: builds the app and sends each request through the HTTP test client. */
const handleDriver: ScenarioDriver = async (app) => {
	const elysia = await app.build();
	const client = createHttpClient((request) => elysia.handle(request));
	return (request) => client.send(request);
};

/**
 * Runs a scenario against a runtime: builds a fresh app, drives its requests through the
 * driver (`elysia.handle` by default), runs the `after` hook, then shuts the app down and resets
 * the container, also when the app factory or a request fails.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @param s The scenario.
 * @param runtime The runtime to run it on.
 * @param assert The assertion adapter of the test framework.
 * @param driver Builds the app and returns how a request reaches it, e.g. a Worker's `fetch`.
 */
export const runScenario = async (
	s: Scenario,
	runtime: Runtime,
	assert: AssertAdapter,
	driver: ScenarioDriver = handleDriver
): Promise<void> => {
	Runtime.use(runtime);
	let app: Application | undefined;
	let failure: { error: unknown } | undefined;
	try {
		app = await s.app();
		await checkRequests(s, await driver(app), assert);
		await s.after?.(app, assert);
	} catch (error) {
		failure = { error };
	}
	await shutDown(app, failure);
};

/**
 * Shuts the app down and resets the container, then rethrows the scenario's failure. A shutdown
 * error is thrown only when the scenario itself passed, so it never masks the first failure.
 */
const shutDown = async (
	app: Application | undefined,
	failure: { error: unknown } | undefined
): Promise<void> => {
	try {
		await app?.kernel.shutdown();
	} catch (error) {
		failure ??= { error };
	} finally {
		// The container is global to the process: leave it empty for the next scenario.
		resetContainer();
	}
	if (failure) throw failure.error;
};
