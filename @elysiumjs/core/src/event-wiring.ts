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

import type { Class } from 'type-fest';
import type { EventData, EventListenerMeta } from './event';
import type { ModuleNode } from './module-graph';

import { Container } from './container';
import { EventListenerNotSupportedError } from './errors';
import { EventBus, getEventListeners } from './event';
import { ModuleContext } from './module-context';
import { Symbols } from './utils';

/**
 * A listener the kernel added to the event bus.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type WiredListener = {
	readonly event: string;
	readonly wrapper: (data: EventData<any>) => Promise<void>;
};

const serviceName = (cls: Class<any>): string =>
	Reflect.getMetadata(Symbols.serviceOptions, cls)?.name ?? cls.name;

const handlerFor = (
	node: ModuleNode,
	cls: Class<any>,
	meta: EventListenerMeta
): ((data: EventData<any>) => Promise<void>) => {
	const method = meta.method as keyof Class<any>;
	return async (data) => {
		try {
			await ModuleContext.run(node, async () => {
				if (meta.static) return (cls as any)[method](data);
				const instance: any = await Container.resolve(serviceName(cls), cls.name);
				return instance[method](data);
			});
		} catch (e: unknown) {
			EventBus.instance.emitError(e);
		}
	};
};

/**
 * Registers the decorated event listeners of `owned` classes on the event bus, each running
 * in `node`'s module context.
 *
 * @param node The module the classes belong to.
 * @param owned The module's own classes (services and controllers).
 * @param services The subset of `owned` registered as services in the module.
 * @returns The listeners added, so they can be removed on shutdown.
 * @throws {EventListenerNotSupportedError} For an instance listener on a non-service class.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export function wireEventListeners(
	node: ModuleNode,
	owned: readonly Class<any>[],
	services: ReadonlySet<Class<any>>
): WiredListener[] {
	const plan = [...new Set(owned)].flatMap((cls) =>
		getEventListeners(cls).map((meta) => {
			if (!meta.static && !services.has(cls)) {
				throw new EventListenerNotSupportedError(cls.name, String(meta.method), node.id);
			}
			return { meta, wrapper: handlerFor(node, cls, meta) };
		})
	);

	const bus = EventBus.instance;
	return plan.map(({ meta, wrapper }) => {
		if (meta.mode === 'once') {
			meta.prepend ? bus.prependOnceListener(meta.event, wrapper) : bus.once(meta.event, wrapper);
		} else {
			meta.prepend ? bus.prependListener(meta.event, wrapper) : bus.on(meta.event, wrapper);
		}
		return { event: meta.event, wrapper };
	});
}
