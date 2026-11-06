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

import type { ModuleClass, ModuleProps } from '@elysiumjs/core';
import type { FlowEngineOptions, FlowHttpContext } from './engine';
import type { AnyFlow } from './flow';

import { Http, Module } from '@elysiumjs/core';

import { FlowEngine } from './engine';
import { InvalidFlowBodyError } from './errors';

/**
 * The configuration of {@link AriadneModule}.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type AriadneOptions = FlowEngineOptions & {
	/** The flows to serve. */
	flows: AnyFlow<any>[];
	/** The path the flow routes start with. Defaults to `flows`. */
	prefix?: string;
	/**
	 * The decorator that authenticates the routes of user flows, such as `Auth()` from themis. It
	 * must put the user in the context, where `user` reads it.
	 */
	authenticate?: ClassDecorator;
};

/** The body of a step, read from the request when Elysia did not parse it. */
const bodyOf = async (http: FlowHttpContext): Promise<unknown> => {
	if (http.body !== undefined) return http.body;
	if (http.request.bodyUsed) return undefined;
	try {
		return await http.request.json();
	} catch {
		throw new InvalidFlowBodyError([{ pointer: '/body', message: 'must be valid JSON' }]);
	}
};

type Handler = (http: FlowHttpContext) => unknown;

/** Declares a route on a method of a controller prototype, as the decorators would. */
const route = (
	proto: Record<string, unknown>,
	name: string,
	decorator: MethodDecorator,
	handler: Handler
): void => {
	proto[name] = handler;
	Http.context()(proto, name, 0);
	decorator(proto, name, Object.getOwnPropertyDescriptor(proto, name)!);
};

/** The controller of one flow: start, state, and one route per step. */
const controllerFor = (flow: AnyFlow, options: AriadneOptions): Function => {
	const engine = new FlowEngine(flow, options);
	const prefix = (options.prefix ?? 'flows').replace(/^\/+|\/+$/g, '');
	const controller = class {};
	Object.defineProperty(controller, 'name', { value: `Flow(${flow.name})` });
	const proto = controller.prototype as Record<string, unknown>;

	route(proto, 'start', Http.post({ path: '/' }), (http) => engine.start(http));
	route(proto, 'state', Http.get({ path: '/' }), (http) => engine.state(http));
	for (const step of Object.keys(flow.steps)) {
		route(proto, `step:${step}`, Http.post({ path: `/${step}` }), async (http) =>
			engine.step({ ...http, body: await bodyOf(http) } as FlowHttpContext, step)
		);
	}

	if (flow.owner === 'user') options.authenticate?.(controller);
	Http.controller({ path: prefix ? `/${prefix}/${flow.name}` : `/${flow.name}` })(controller);
	return controller;
};

/**
 * Serves flows over HTTP. For each flow:
 *
 * - `POST /{prefix}/{flow}` starts it, and answers its `flowKey` (and the `owner` token of a guest
 *   flow, which later calls send in the `x-flow-owner` header);
 * - `GET /{prefix}/{flow}?flowKey=` tells where it stands;
 * - `POST /{prefix}/{flow}/{step}` runs a step, with `{ flowKey, stepId, ...body }`.
 * @author Axel Nana <axel.nana@workbud.com>
 * @example
 * ```ts
 * @Application.register({
 * 	modules: [AriadneModule.with({ flows: [signUp], store: new MemoryFlowStore() })]
 * })
 * class App extends Application {}
 * ```
 */
export abstract class AriadneModule extends Module {
	/**
	 * A module that serves the flows.
	 * @author Axel Nana <axel.nana@workbud.com>
	 */
	public static with(options: AriadneOptions): ModuleClass {
		const names = options.flows.map((flow) => flow.name);
		const duplicate = names.find((name, index) => names.indexOf(name) !== index);
		if (duplicate) throw new TypeError(`The flow "${duplicate}" is declared twice.`);
		const controllers = options.flows.map((flow) => controllerFor(flow, options));

		@Module.register({ controllers: controllers as ModuleProps['controllers'] })
		class ServedFlows extends AriadneModule {}
		Object.defineProperty(ServedFlows, 'name', { value: 'AriadneModule' });
		return ServedFlows as unknown as ModuleClass;
	}
}
