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

import type { CommandLock, IdempotencyStore, InboxStore, OutboxStore } from './stores';

import { Service } from '@elysiumjs/core';

import { MissingStoreError } from './errors';

/** The service names of the moirai stores and options. */
export const MOIRAI_IDEMPOTENCY_STORE = 'moirai.idempotency';
export const MOIRAI_OUTBOX_STORE = 'moirai.outbox';
export const MOIRAI_INBOX_STORE = 'moirai.inbox';
export const MOIRAI_COMMAND_LOCK = 'moirai.lock';
export const MOIRAI_OPTIONS = 'moirai.options';

/**
 * How moirai runs commands and relays the outbox.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type MoiraiOptions = {
	/** The attempts of a command that fails with a transient error. Defaults to 3. */
	maxAttempts: number;
	/**
	 * Whether an error is transient, so that the command retries in a new unit of work. Defaults to
	 * errors with `transient: true` and the Postgres serialization failure and deadlock codes.
	 */
	isTransient: (error: unknown) => boolean;
	/** Whether the effects a command enqueues relay right after it commits. Defaults to `true`. */
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

/** The moirai options, or the defaults when MoiraiModule is not loaded. */
export const options = (): MoiraiOptions =>
	(Service.exists(MOIRAI_OPTIONS) ? Service.get<MoiraiOptions>(MOIRAI_OPTIONS) : null) ??
	DEFAULT_OPTIONS;

const store =
	<T>(token: string, name: string) =>
	(): T => {
		const found = Service.exists(token) ? Service.get<T>(token) : null;
		if (!found) throw new MissingStoreError(name);
		return found;
	};

export const idempotencyStore = store<IdempotencyStore>(MOIRAI_IDEMPOTENCY_STORE, 'idempotency');
export const outboxStore = store<OutboxStore>(MOIRAI_OUTBOX_STORE, 'outbox');
export const inboxStore = store<InboxStore>(MOIRAI_INBOX_STORE, 'inbox');
export const commandLock = store<CommandLock>(MOIRAI_COMMAND_LOCK, 'lock');
