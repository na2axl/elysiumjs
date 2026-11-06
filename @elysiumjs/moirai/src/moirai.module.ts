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

import type { MoiraiOptions } from './config';
import type { ActionLock, IdempotencyStore, InboxStore, OutboxStore } from './stores';

import { Module } from '@elysiumjs/core';

import {
	DEFAULT_OPTIONS,
	DEFAULT_STORE_SET,
	MOIRAI_ACTION_LOCK,
	MOIRAI_IDEMPOTENCY_STORE,
	MOIRAI_INBOX_STORE,
	MOIRAI_OPTIONS,
	MOIRAI_OUTBOX_STORE,
	storeServiceName
} from './config';
import { ReservedStoreSetError } from './errors';

type StoreOption<T> = T | (() => T);

/**
 * A store set: the stores, built once, and the options that differ from the ones of the default
 * set. A named set that leaves a store out shares the one of the default set.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type MoiraiStoreSet = Partial<MoiraiOptions> & {
	idempotency?: StoreOption<IdempotencyStore>;
	outbox?: StoreOption<OutboxStore>;
	inbox?: StoreOption<InboxStore>;
	lock?: StoreOption<ActionLock>;
};

/**
 * The configuration of {@link MoiraiModule}: the default store set and the options, and the named
 * store sets in `stores`.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type MoiraiModuleConfig = MoiraiStoreSet & {
	/**
	 * Named store sets, such as one per domain with its own outbox and inbox tables. Actions, event
	 * handlers and relays pick one with their `stores` option.
	 */
	stores?: Record<string, MoiraiStoreSet>;
};

const build = <T>(option: StoreOption<T>): T =>
	typeof option === 'function' ? (option as () => T)() : option;

/** The services of one store set: its options, then the stores it sets. */
const servicesOf = (set: string, config: MoiraiStoreSet) => {
	const { idempotency, outbox, inbox, lock, ...rest } = config;
	const stores: [string, StoreOption<unknown> | undefined][] = [
		[MOIRAI_IDEMPOTENCY_STORE, idempotency],
		[MOIRAI_OUTBOX_STORE, outbox],
		[MOIRAI_INBOX_STORE, inbox],
		[MOIRAI_ACTION_LOCK, lock]
	];
	return [
		{
			name: storeServiceName(MOIRAI_OPTIONS, set),
			global: true,
			// A named set keeps only its overrides: the options of the default set fill the rest.
			factory: () => (set === DEFAULT_STORE_SET ? { ...DEFAULT_OPTIONS, ...rest } : { ...rest })
		},
		...stores
			.filter(([, option]) => option !== undefined)
			.map(([name, option]) => ({
				name: storeServiceName(name, set),
				global: true,
				factory: () => build(option!)
			}))
	];
};

/** @internal The services of the configuration: the default set, then each named set. */
export const moiraiServices = (config: MoiraiModuleConfig) => {
	const { stores = {}, ...defaults } = config;
	if (Object.hasOwn(stores, DEFAULT_STORE_SET)) throw new ReservedStoreSetError();
	return [
		...servicesOf(DEFAULT_STORE_SET, defaults),
		...Object.entries(stores).flatMap(([set, options]) => servicesOf(set, options))
	];
};

/**
 * Provides the moirai stores and options as global services. Set the stores the app uses: the
 * memory ones (`MemoryIdempotencyStore`, ...) for tests, the Postgres ones of
 * `@elysiumjs/moirai-drizzle` in production. Named store sets in `stores` give each part of the
 * app its own stores, such as the outbox and inbox tables of each domain.
 * @author Axel Nana <axel.nana@workbud.com>
 * @example
 * ```ts
 * MoiraiModule.with({
 * 	idempotency: () => new DrizzleIdempotencyStore({ table: tables.idempotencyKeys }),
 * 	lock: () => new PgAdvisoryLock(),
 * 	stores: {
 * 		billing: {
 * 			outbox: () => new DrizzleOutboxStore({ table: billing.outbox }),
 * 			inbox: () => new DrizzleInboxStore({ table: billing.inbox })
 * 		}
 * 	}
 * });
 * ```
 */
@Module.register<MoiraiModuleConfig>({ services: (config) => moiraiServices(config) })
export class MoiraiModule extends Module.configurable<MoiraiModuleConfig>() {}
