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
	ActionLock,
	EventStore,
	IdempotencyStore,
	InboxStore,
	OutboxStore,
	ProjectionStorage
} from './stores';

import { ModuleContext, Service } from '@elysiumjs/core';

import { MissingStoreError } from './errors';

/** The service names of the moirai stores and options. */
export const MOIRAI_IDEMPOTENCY_STORE = 'moirai.idempotency';
export const MOIRAI_OUTBOX_STORE = 'moirai.outbox';
export const MOIRAI_INBOX_STORE = 'moirai.inbox';
export const MOIRAI_ACTION_LOCK = 'moirai.lock';
export const MOIRAI_EVENT_STORE = 'moirai.events';
export const MOIRAI_PROJECTION_STORAGE = 'moirai.projections';
export const MOIRAI_OPTIONS = 'moirai.options';

/** The service name of the options a module overrides with `Moirai.stores()`. */
export const MOIRAI_MODULE_OPTIONS = 'moirai.module-options';

/**
 * How moirai runs actions and relays the outbox.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type MoiraiOptions = {
	/** The attempts of an action that fails with a transient error. Defaults to 3. */
	maxAttempts: number;
	/**
	 * Whether an error is transient, so that the action retries in a new unit of work. Defaults to
	 * errors with `transient: true` and the Postgres serialization failure and deadlock codes.
	 */
	isTransient: (error: unknown) => boolean;
	/** Whether the effects an action enqueues relay right after it commits. Defaults to `true`. */
	relayOnCommit: boolean;
	/**
	 * Runs the relay that follows a commit. Defaults to awaiting it before the response. On
	 * Cloudflare Workers, pass `(work) => Workers.context().waitUntil(work)` to answer first.
	 */
	defer?: (work: Promise<unknown>) => void;
	/** The attempts of an outbox row before it is dead. Defaults to 8. */
	maxRelayAttempts: number;
	/** The rows a relay claims at once. Defaults to 50. */
	relayBatch: number;
	/**
	 * How long a relay holds the rows it claimed, in seconds. A row its relay did not mark in that
	 * time is due again. Defaults to 300.
	 */
	relayLease: number;
	/** Called when an outbox row is dead, such as to raise an alert. */
	onDead?: (row: import('./stores').OutboxRow, error: Error) => void;
	/**
	 * The metadata of every stored event, such as the current actor and correlation id. The
	 * `metadata` given to `Streams.act()` is added to it.
	 */
	eventMetadata?: () => Record<string, unknown>;
};

const TRANSIENT_CODES = new Set(['40001', '40P01']);

/** The default transient check: `transient: true`, or a Postgres serialization failure or deadlock. */
export const isTransientError = (error: unknown): boolean => {
	if (typeof error !== 'object' || error === null) return false;
	const { transient, code, errno, cause } = error as {
		transient?: unknown;
		code?: unknown;
		errno?: unknown;
		cause?: unknown;
	};
	if (transient === true) return true;
	if (typeof code === 'string' && TRANSIENT_CODES.has(code)) return true;
	// Bun's SQL driver keeps the SQLSTATE in `errno`.
	if (typeof errno === 'string' && TRANSIENT_CODES.has(errno)) return true;
	return cause !== undefined && cause !== error && isTransientError(cause);
};

export const DEFAULT_OPTIONS: MoiraiOptions = {
	maxAttempts: 3,
	isTransient: isTransientError,
	relayOnCommit: true,
	maxRelayAttempts: 8,
	relayBatch: 50,
	relayLease: 300
};

const lookup = <T>(name: string): T | null => Service.get<T>(name);

/**
 * The options of the current module: the defaults, then the options of `MoiraiModule`, then the
 * ones the module overrides with `Moirai.stores()`.
 */
export const options = (): MoiraiOptions => {
	const base = lookup<MoiraiOptions>(MOIRAI_OPTIONS) ?? DEFAULT_OPTIONS;
	const own = lookup<Partial<MoiraiOptions>>(MOIRAI_MODULE_OPTIONS);
	return own ? { ...base, ...own } : base;
};

const store =
	<T>(name: string, kind: string) =>
	(): T => {
		// The stores of the current module, else the ones its imports export, else the global ones.
		const found = lookup<T>(name);
		if (!found) throw new MissingStoreError(kind, ModuleContext.current()?.id);
		return found;
	};

export const idempotencyStore = store<IdempotencyStore>(MOIRAI_IDEMPOTENCY_STORE, 'idempotency');
export const outboxStore = store<OutboxStore>(MOIRAI_OUTBOX_STORE, 'outbox');
export const inboxStore = store<InboxStore>(MOIRAI_INBOX_STORE, 'inbox');
export const actionLock = store<ActionLock>(MOIRAI_ACTION_LOCK, 'lock');
export const eventStore = store<EventStore>(MOIRAI_EVENT_STORE, 'events');
export const projectionStorage = store<ProjectionStorage>(MOIRAI_PROJECTION_STORAGE, 'projections');

/**
 * Runs work in the context of the module that declares a service, such as the module of an
 * action or of an event handler, so that it uses that module's stores. Without such a module, the
 * work runs in the current context.
 */
export const inOwnerModule = <T>(service: object, work: () => T): T => {
	const owner = Service.ownersOf(service as never)[0];
	return owner && owner !== ModuleContext.current() ? ModuleContext.run(owner, work) : work();
};
