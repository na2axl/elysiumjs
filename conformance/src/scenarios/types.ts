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

import type { Application } from '@elysiumjs/core';

/**
 * A runtime-agnostic scenario: a fresh application and the requests driven through it.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type Scenario = {
	name: string;
	/** Builds a fresh application class instance. No runtime is set on it. */
	app: () => Promise<Application>;
	requests: {
		/** Builds the request. It receives the JSON bodies of the earlier responses, in order. */
		request: (previous: unknown[]) => Request;
		expect: {
			status: number;
			json?: unknown;
			/** Top-level properties the JSON body has, besides others that may vary. */
			includes?: Record<string, unknown>;
			text?: string;
			headers?: Record<string, string>;
		};
	}[];
	/** Extra assertions run after the requests (e.g. destroy logs), through the lane's adapter. */
	after?: (app: Application, assert: AssertAdapter) => Promise<void> | void;
};

/** The assertion adapter a lane injects, so scenarios never import a test framework. */
export type AssertAdapter = { equal(a: unknown, b: unknown, msg: string): void };

/**
 * Builds a scenario's app and returns the function each of its requests goes through. The
 * default builds the app and calls `elysia.handle`; the workerd lane goes through a Worker's
 * `fetch`.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type ScenarioDriver = (app: Application) => Promise<(request: Request) => Promise<Response>>;
