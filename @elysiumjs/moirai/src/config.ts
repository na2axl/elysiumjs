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

import type { ActionLock, IdempotencyStore, InboxStore, OutboxStore } from './stores';

import { AsyncLocalStorage } from 'node:async_hooks';

import { Service } from '@elysiumjs/core';

import { MissingStoreError } from './errors';

/** The service names of the moirai stores and options. */
export const MOIRAI_IDEMPOTENCY_STORE = 'moirai.idempotency';
export const MOIRAI_OUTBOX_STORE = 'moirai.outbox';
export const MOIRAI_INBOX_STORE = 'moirai.inbox';
export const MOIRAI_ACTION_LOCK = 'moirai.lock';
export const MOIRAI_OPTIONS = 'moirai.options';

/** The name of the store set `MoiraiModule` sets outside its `stores` map. */
export const DEFAULT_STORE_SET = 'default';

/**
 * The service name of a store or of the options of a store set: the base name for the default
 * set, `<base>:<set>` for a named one, such as `moirai.outbox:billing`.
 * @author Axel Nana <axel.nana@workbud.com>
 * @param base The service name in the default set, such as {@link MOIRAI_OUTBOX_STORE}.
 * @param set The name of the store set.
 */
export const storeServiceName = (base: string, set: string): string =>
	set === DEFAULT_STORE_SET ? base : `${base}:${set}`;

/**
 * How moirai runs actions and relays the outbox.
 * @author Axel Nana <axel.nana@workbud.com>
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

const currentSet = new AsyncLocalStorage<string>();

/** The store set current in this async context: the one of the running action, relay or handler. */
export const currentStoreSet = (): string => currentSet.getStore() ?? DEFAULT_STORE_SET;

/** Runs work with a store set current, or in the current one when `set` is undefined. */
export const inStoreSet = <T>(set: string | undefined, work: () => T): T =>
	set === undefined || set === currentSet.getStore() ? work() : currentSet.run(set, work);

const lookup = <T>(name: string): T | null => (Service.exists(name) ? Service.get<T>(name) : null);

/**
 * The options of a store set: the defaults, then the options of the default set, then the ones the
 * named set overrides.
 */
export const options = (set: string = currentStoreSet()): MoiraiOptions => {
	const base = lookup<MoiraiOptions>(MOIRAI_OPTIONS) ?? DEFAULT_OPTIONS;
	if (set === DEFAULT_STORE_SET) return base;
	const own = lookup<Partial<MoiraiOptions>>(storeServiceName(MOIRAI_OPTIONS, set));
	return own ? { ...base, ...own } : base;
};

const store =
	<T>(base: string, kind: string) =>
	(set: string = currentStoreSet()): T => {
		// A named set that does not set a store shares the one of the default set.
		const found =
			lookup<T>(storeServiceName(base, set)) ??
			(set === DEFAULT_STORE_SET ? null : lookup<T>(base));
		if (!found) throw new MissingStoreError(kind, set);
		return found;
	};

export const idempotencyStore = store<IdempotencyStore>(MOIRAI_IDEMPOTENCY_STORE, 'idempotency');
export const outboxStore = store<OutboxStore>(MOIRAI_OUTBOX_STORE, 'outbox');
export const inboxStore = store<InboxStore>(MOIRAI_INBOX_STORE, 'inbox');
export const actionLock = store<ActionLock>(MOIRAI_ACTION_LOCK, 'lock');
