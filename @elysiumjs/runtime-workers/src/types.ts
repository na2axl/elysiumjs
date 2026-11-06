// Copyright (c) 2026-present Workbud Technologies Inc. All rights reserved.
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
 * The parts of the Cloudflare Workers API the adapter uses. They are structural, so the types
 * from `@cloudflare/workers-types` (or `wrangler types`) fit them.
 * @module
 */

/** The `ctx` argument of a Worker handler. */
export interface WorkersExecutionContext {
	waitUntil(promise: Promise<unknown>): void;
	passThroughOnException(): void;
}

/** A message of a queue batch. */
export interface WorkersQueueMessage<Body = unknown> {
	readonly id: string;
	readonly timestamp: Date;
	readonly body: Body;
	readonly attempts: number;
	ack(): void;
	retry(options?: { delaySeconds?: number }): void;
}

/** The batch a queue consumer receives. */
export interface WorkersMessageBatch<Body = unknown> {
	readonly queue: string;
	readonly messages: readonly WorkersQueueMessage<Body>[];
	ackAll(): void;
	retryAll(options?: { delaySeconds?: number }): void;
}

/** The controller of a scheduled (cron) event. */
export interface WorkersScheduledController {
	readonly scheduledTime: number;
	readonly cron: string;
	noRetry(): void;
}

/** A Workers KV namespace binding. */
export interface WorkersKVNamespace {
	get(key: string, type: 'text'): Promise<string | null>;
	put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
	delete(key: string): Promise<void>;
	list(options?: { prefix?: string; cursor?: string; limit?: number }): Promise<{
		keys: { name: string }[];
		list_complete: boolean;
		cursor?: string;
	}>;
}

/** The stub of a Durable Object, as its namespace returns it. */
export interface WorkersDurableObjectStub {
	fetch(input: string | Request, init?: RequestInit): Promise<Response>;
}

/** A Durable Object namespace binding. */
export interface WorkersDurableObjectNamespace {
	idFromName(name: string): unknown;
	get(id: any): WorkersDurableObjectStub;
}

/** The storage of a Durable Object. */
export interface WorkersDurableObjectStorage {
	get<T = unknown>(key: string): Promise<T | undefined>;
	put<T>(key: string, value: T): Promise<void>;
	deleteAll(): Promise<void>;
	setAlarm(scheduledTime: number): Promise<void>;
}

/** The `state` argument of a Durable Object constructor. */
export interface WorkersDurableObjectState {
	readonly storage: WorkersDurableObjectStorage;
}

/** The handlers a Worker module exports. */
export interface WorkersHandler<Env = Record<string, unknown>> {
	fetch(request: Request, env: Env, ctx: WorkersExecutionContext): Promise<Response>;
	queue(batch: WorkersMessageBatch, env: Env, ctx: WorkersExecutionContext): Promise<void>;
	scheduled(
		controller: WorkersScheduledController,
		env: Env,
		ctx: WorkersExecutionContext
	): Promise<void>;
}
