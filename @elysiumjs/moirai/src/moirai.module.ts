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

import type { ServiceDefinition } from '@elysiumjs/core';
import type { MoiraiOptions } from './config';
import type {
	ActionLock,
	EventStore,
	IdempotencyStore,
	InboxStore,
	OutboxStore,
	ProjectionStorage
} from './stores';

import { Module } from '@elysiumjs/core';

import { ProjectionRebuildCommand } from './commands/projection-rebuild.command';
import {
	DEFAULT_OPTIONS,
	MOIRAI_ACTION_LOCK,
	MOIRAI_EVENT_STORE,
	MOIRAI_IDEMPOTENCY_STORE,
	MOIRAI_INBOX_STORE,
	MOIRAI_MODULE_OPTIONS,
	MOIRAI_OPTIONS,
	MOIRAI_OUTBOX_STORE,
	MOIRAI_PROJECTION_STORAGE
} from './config';

type StoreOption<T> = T | (() => T);

/**
 * Stores, each an instance or a function that builds it once, and options.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type MoiraiStores = Partial<MoiraiOptions> & {
	idempotency?: StoreOption<IdempotencyStore>;
	outbox?: StoreOption<OutboxStore>;
	inbox?: StoreOption<InboxStore>;
	lock?: StoreOption<ActionLock>;
	events?: StoreOption<EventStore>;
	projections?: StoreOption<ProjectionStorage>;
};

/**
 * The configuration of {@link MoiraiModule}: the stores of the application and the options.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type MoiraiModuleConfig = MoiraiStores;

const build = <T>(option: StoreOption<T>): T =>
	typeof option === 'function' ? (option as () => T)() : option;

/** The service definitions of stores and options, global or private to the declaring module. */
const definitions = (config: MoiraiStores, global: boolean): ServiceDefinition[] => {
	const { idempotency, outbox, inbox, lock, events, projections, ...rest } = config;
	const stores: [string, StoreOption<unknown> | undefined][] = [
		[MOIRAI_IDEMPOTENCY_STORE, idempotency],
		[MOIRAI_OUTBOX_STORE, outbox],
		[MOIRAI_INBOX_STORE, inbox],
		[MOIRAI_ACTION_LOCK, lock],
		[MOIRAI_EVENT_STORE, events],
		[MOIRAI_PROJECTION_STORAGE, projections]
	];
	const options: ServiceDefinition[] = global
		? [{ name: MOIRAI_OPTIONS, global, factory: () => ({ ...DEFAULT_OPTIONS, ...rest }) }]
		: Object.keys(rest).length > 0
			? [{ name: MOIRAI_MODULE_OPTIONS, global, factory: () => ({ ...rest }) }]
			: [];
	return [
		...options,
		...stores
			.filter(([, option]) => option !== undefined)
			.map(([name, option]) => ({ name, global, factory: () => build(option!) }))
	];
};

/** @internal The services of `Moirai.stores()`: private to the module that lists them. */
export const moduleStores = (config: MoiraiStores): ServiceDefinition[] =>
	definitions(config, false);

/**
 * Provides the moirai stores and options of the application as global services. Set the stores
 * the app uses: the memory ones (`MemoryIdempotencyStore`, ...) for tests, the Postgres ones of
 * `@elysiumjs/moirai-drizzle` in production. A module that needs stores of its own, such as the
 * outbox and inbox tables of a domain, lists them with `Moirai.stores()` in its services.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @example
 * ```ts
 * MoiraiModule.with({
 * 	idempotency: () => new DrizzleIdempotencyStore({ table: tables.idempotencyKeys }),
 * 	outbox: () => new DrizzleOutboxStore({ table: tables.outbox }),
 * 	inbox: () => new DrizzleInboxStore({ table: tables.inbox }),
 * 	lock: () => new PgAdvisoryLock()
 * });
 * ```
 */
@Module.register<MoiraiModuleConfig>({
	commands: [ProjectionRebuildCommand],
	services: (config) => definitions(config, true)
})
export class MoiraiModule extends Module.configurable<MoiraiModuleConfig>() {}
