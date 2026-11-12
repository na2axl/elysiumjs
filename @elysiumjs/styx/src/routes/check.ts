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

import type { Application } from '@elysiumjs/core';

import { Http } from '@elysiumjs/core';

/**
 * A route that declares no schema for its success response.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type RouteWithoutResponse = {
	/** The id of the module of the controller. */
	module: string;
	/** The name of the controller class. */
	controller: string;
	/** The name of the controller method. */
	handler: string;
	/** The HTTP method, in upper case. */
	method: string;
	/** The full path of the route, with the module prefix and the controller path. */
	path: string;
};

const join = (...parts: (string | undefined)[]): string =>
	`/${parts
		.filter((part): part is string => part !== undefined && part !== '' && part !== '/')
		.map((part) => part.replace(/^\/+|\/+$/g, ''))
		.join('/')}`;

/**
 * Finds the routes of an app that declare no schema for their success response. Server-sent
 * events routes and routes answering 204 have no response body, and are left out.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @param app The application class. Its modules are read, not booted.
 */
export const routesWithoutResponse = async (
	app: typeof Application
): Promise<RouteWithoutResponse[]> => {
	// Route decorators register their routes on the next tick.
	await new Promise((resolve) => process.nextTick(resolve));

	const graph = app.moduleGraph('production');
	const found: RouteWithoutResponse[] = [];
	for (const node of graph.nodes) {
		for (const controller of graph.own(node, 'controllers')) {
			const description = Http.describe(controller);
			if (!description) continue;
			for (const route of description.routes) {
				if (route.responds || route.sse || route.status === 204) continue;
				found.push({
					module: node.id,
					controller: controller.name,
					handler: route.name,
					method: route.method,
					path: join(node.props.prefix, description.path, route.path)
				});
			}
		}
	}
	return found;
};
