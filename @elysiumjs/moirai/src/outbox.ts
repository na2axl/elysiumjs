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

import type { OutboxEffect, OutboxRow } from './stores';

import { DATABASE_TRANSACTION_SERVICE, getLogger, Service } from '@elysiumjs/core';
import { UnitOfWork } from '@elysiumjs/mnemosyne';

import { effectHandler } from './command';
import { inboxStore, options, outboxStore } from './config';
import { UnknownEffectError } from './errors';
import { uuidv7 } from './ids';

const BASE_DELAY_MS = 5_000;
const MAX_DELAY_MS = 3_600_000;

/**
 * The delay before the next attempt of an outbox row: 5 s, 10 s, 20 s, ... up to 1 h.
 * @author Axel Nana <axel.nana@workbud.com>
 * @param attempts The failed attempts so far.
 */
export const backoffMs = (attempts: number): number =>
	Math.min(BASE_DELAY_MS * 2 ** Math.max(0, attempts - 1), MAX_DELAY_MS);

/**
 * What one relay did.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type RelaySummary = { dispatched: number; retried: number; dead: number };

/**
 * Narrows and sizes one relay.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type RelayOptions = {
	/** Relay only the rows of these kinds. */
	kinds?: readonly string[];
	/** Relay only these rows, such as the ones a command just committed. */
	ids?: readonly string[];
	/** The rows claimed at once. Defaults to the `relayBatch` option. */
	batch?: number;
};

const asError = (error: unknown): Error =>
	error instanceof Error ? error : new Error(String(error));

/** Runs work in a unit of work when a database module is loaded, else as it is. */
const inUnitOfWork = <T>(work: () => Promise<T>): Promise<T> =>
	Service.exists(DATABASE_TRANSACTION_SERVICE) ? UnitOfWork.run(work) : work();

export namespace Outbox {
	/**
	 * Writes effects to the outbox, in the open unit of work: they happen if and only if it
	 * commits. Once it has, the effects relay (see the `relayOnCommit` option).
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param effects The effects.
	 * @returns The ids of the rows, in order.
	 */
	export const enqueue = async (...effects: OutboxEffect[]): Promise<string[]> => {
		if (effects.length === 0) return [];
		const now = new Date();
		const rows: OutboxRow[] = effects.map((effect) => ({
			id: uuidv7(now.getTime()),
			kind: effect.kind,
			payload: structuredClone(effect.payload),
			createdAt: now,
			availableAt: effect.availableAt ?? now,
			attempts: 0,
			lastError: null,
			dispatchedAt: null,
			deadAt: null
		}));
		await outboxStore().insert(rows);

		const config = options();
		if (config.relayOnCommit) {
			const ids = rows.filter((row) => row.availableAt <= now).map((row) => row.id);
			if (ids.length > 0) {
				await UnitOfWork.afterCommit(() => {
					const work = relay({ ids }).catch((error) =>
						getLogger().error('The outbox relay after a commit failed', { error })
					);
					if (config.defer) config.defer(work);
					else return work;
				});
			}
		}
		return rows.map((row) => row.id);
	};

	/**
	 * Runs the due rows of the outbox through their `@Moirai.effect()` handlers. A row that fails
	 * is retried later with an exponential backoff, and is dead after `maxRelayAttempts`. Delivery
	 * is at least once, so handlers must tolerate a repeat.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param relayOptions The rows to relay.
	 */
	export const relay = (relayOptions: RelayOptions = {}): Promise<RelaySummary> => {
		const config = options();
		const store = outboxStore();
		return inUnitOfWork(async () => {
			const summary: RelaySummary = { dispatched: 0, retried: 0, dead: 0 };
			const rows = await store.claimDue(new Date(), relayOptions.batch ?? config.relayBatch, {
				kinds: relayOptions.kinds,
				ids: relayOptions.ids
			});
			for (const row of rows) {
				try {
					const handler = effectHandler(row.kind);
					if (!handler) throw new UnknownEffectError(row.kind);
					await handler(row.payload, row);
					await store.markDispatched(row.id, new Date());
					summary.dispatched++;
				} catch (cause) {
					const error = asError(cause);
					const attempts = row.attempts + 1;
					const now = new Date();
					if (attempts >= config.maxRelayAttempts) {
						await store.markDead(row.id, { attempts, lastError: error.message, deadAt: now });
						config.onDead?.(row, error);
						getLogger().error('An outbox row is dead', { id: row.id, kind: row.kind, error });
						summary.dead++;
					} else {
						const availableAt = new Date(now.getTime() + backoffMs(attempts));
						await store.markFailed(row.id, { attempts, lastError: error.message, availableAt });
						summary.retried++;
					}
				}
			}
			return summary;
		});
	};

	/**
	 * Relays every due row, batch after batch, such as from a cron trigger. Stops when a batch
	 * dispatches nothing.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param relayOptions The kinds to relay and the batch size.
	 */
	export const sweep = async (
		relayOptions: Omit<RelayOptions, 'ids'> = {}
	): Promise<RelaySummary> => {
		const total: RelaySummary = { dispatched: 0, retried: 0, dead: 0 };
		for (;;) {
			const summary = await relay(relayOptions);
			total.dispatched += summary.dispatched;
			total.retried += summary.retried;
			total.dead += summary.dead;
			if (summary.dispatched + summary.retried + summary.dead === 0) return total;
		}
	};
}

export namespace Inbox {
	/**
	 * Runs work unless this consumer already processed the message. Call it in the consumer's unit
	 * of work, so that a failure rolls the record back and the redelivery runs the work again.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param message The id of the message and the name of the consumer.
	 * @param work The work.
	 * @returns Whether the work ran.
	 */
	export const once = async (
		message: { messageId: string; consumer: string },
		work: () => Promise<void> | void
	): Promise<boolean> => {
		if (!(await inboxStore().record(message.messageId, message.consumer))) return false;
		await work();
		return true;
	};
}
