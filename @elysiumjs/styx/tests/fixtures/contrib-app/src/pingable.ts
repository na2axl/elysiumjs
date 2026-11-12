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

import type {
	HttpRouteDescription,
	HttpRouteTypeRef,
	HttpRouteTypesContributor
} from '@elysiumjs/core';

import { Environments, Http, Service } from '@elysiumjs/core';

const pinged = new WeakSet<Function>();

/** Declares a controller with a `GET /ping` route that is not a method of the class type. */
export const pingable =
	(path: `/${string}`): ClassDecorator =>
	(target) => {
		const proto = target.prototype as Record<string, unknown>;
		Object.defineProperty(proto, 'ping:route', {
			value: () => ({ pong: true }),
			configurable: true,
			writable: true
		});
		Http.get('/ping')(proto, 'ping:route', Object.getOwnPropertyDescriptor(proto, 'ping:route')!);
		pinged.add(target);
		Http.controller(path)(target as any);
	};

/** Types the routes `pingable` adds, and the replies of the other routes. */
@Service.register({ tags: [Http.RouteTypes], global: true, env: Environments.local })
export class PingRouteTypes implements HttpRouteTypesContributor {
	public supports(controller: Function): boolean {
		return pinged.has(controller);
	}

	public route(_controller: Function, route: HttpRouteDescription, ref: HttpRouteTypeRef) {
		if (route.name === 'ping:route') {
			return { response: 'Pong', imports: [{ from: './pong', names: ['Pong'] }] };
		}
		return ref.method ? { response: `{ reply: ReturnType<${ref.method}> }` } : undefined;
	}
}
