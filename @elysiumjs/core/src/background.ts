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

import type { ServiceProps } from './service';

import { Service } from './service';

/**
 * A unit of background work: what runs outside a request, such as a job, an event handler or an
 * outbox handler.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type BackgroundWork = {
	/** What runs, such as `job`, `event` or `outbox`. */
	readonly kind: string;

	/** The name of what runs, such as the name of the job or of the event consumer. */
	readonly name: string;
};

/**
 * Wraps every unit of background work, the way interceptors wrap requests: it sets what the work
 * needs around it, such as a config or an actor scope.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export interface BackgroundScope {
	/**
	 * Runs a unit of background work.
	 * @param work What runs.
	 * @param next Runs the work, inside the scopes registered after this one.
	 * @returns What `next` returns.
	 */
	run<T>(work: BackgroundWork, next: () => Promise<T>): Promise<T>;
}

const BACKGROUND_SCOPES = Service.tag<BackgroundScope>('elysium.background.scopes');

/**
 * Background work: the scopes that wrap it, and the runner that the job, event and outbox
 * packages call.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export namespace Background {
	/**
	 * Registers a service as a background scope: it wraps every unit of background work of the
	 * application. Scopes nest in the order the modules register them, the first one outermost.
	 * @example
	 * ```ts
	 * @Background.scope()
	 * export class SystemActorScope implements BackgroundScope {
	 * 	public run<T>(work: BackgroundWork, next: () => Promise<T>): Promise<T> {
	 * 		return Actor.run(Actor.system(work.name), next);
	 * 	}
	 * }
	 * ```
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param props The service options.
	 */
	export const scope = (props: ServiceProps = {}) =>
		Service.register({ ...props, tags: [...(props.tags ?? []), BACKGROUND_SCOPES] });

	/**
	 * Runs a unit of background work inside every background scope.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param work What runs.
	 * @param fn The work.
	 * @returns What the work returns.
	 */
	export const run = async <T>(work: BackgroundWork, fn: () => Promise<T>): Promise<T> => {
		const scopes = await Service.resolveAll(BACKGROUND_SCOPES);
		const step = (index: number): Promise<T> =>
			index < scopes.length ? scopes[index]!.run(work, () => step(index + 1)) : fn();
		return step(0);
	};
}
