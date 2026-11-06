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
import type { CommandLock, IdempotencyStore, InboxStore, OutboxStore } from './stores';

import { Module } from '@elysiumjs/core';

import {
	DEFAULT_OPTIONS,
	MOIRAI_COMMAND_LOCK,
	MOIRAI_IDEMPOTENCY_STORE,
	MOIRAI_INBOX_STORE,
	MOIRAI_OPTIONS,
	MOIRAI_OUTBOX_STORE
} from './config';

type StoreOption<T> = T | (() => T);

/**
 * The configuration of {@link MoiraiModule}: the stores, built once, and the options.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type MoiraiModuleConfig = Partial<MoiraiOptions> & {
	idempotency?: StoreOption<IdempotencyStore>;
	outbox?: StoreOption<OutboxStore>;
	inbox?: StoreOption<InboxStore>;
	lock?: StoreOption<CommandLock>;
};

const build = <T>(option: StoreOption<T>): T =>
	typeof option === 'function' ? (option as () => T)() : option;

/**
 * Provides the moirai stores and options as global services. Set the stores the app uses: the
 * memory ones (`MemoryIdempotencyStore`, ...) for tests, the Postgres ones of
 * `@elysiumjs/mnemosyne-drizzle/moirai` in production.
 * @author Axel Nana <axel.nana@workbud.com>
 * @example
 * ```ts
 * MoiraiModule.with({
 * 	idempotency: () => new DrizzleIdempotencyStore(tables.idempotencyKeys),
 * 	outbox: () => new DrizzleOutboxStore(tables.outbox),
 * 	inbox: () => new DrizzleInboxStore(tables.inbox),
 * 	lock: () => new PgAdvisoryLock()
 * });
 * ```
 */
@Module.register<MoiraiModuleConfig>({
	services: (config) => {
		const { idempotency, outbox, inbox, lock, ...rest } = config;
		const stores: [string, StoreOption<unknown> | undefined][] = [
			[MOIRAI_IDEMPOTENCY_STORE, idempotency],
			[MOIRAI_OUTBOX_STORE, outbox],
			[MOIRAI_INBOX_STORE, inbox],
			[MOIRAI_COMMAND_LOCK, lock]
		];
		return [
			{ name: MOIRAI_OPTIONS, global: true, factory: () => ({ ...DEFAULT_OPTIONS, ...rest }) },
			...stores
				.filter(([, option]) => option !== undefined)
				.map(([name, option]) => ({ name, global: true, factory: () => build(option!) }))
		];
	}
})
export class MoiraiModule extends Module.configurable<MoiraiModuleConfig>() {}
