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

import type { Static } from 'typebox';
import type { StoredEventMeta } from '../../src/moirai';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { Type as t } from 'typebox';

import { DomainError, isDomainError, MemoryLock, Result, Service } from '../../src/index';
import { withUnitOfWork } from '../../src/mnemosyne/index';
import {
	Action,
	Aggregate,
	ConcurrencyConflictError,
	DEFAULT_OPTIONS_FOR_TESTS,
	DuplicateStreamNameError,
	Event,
	MemoryEventStore,
	MemoryIdempotencyStore,
	MemoryInboxStore,
	MemoryOutboxStore,
	MemoryProjectionStorage,
	Moirai,
	MOIRAI_ACTION_LOCK,
	MOIRAI_EVENT_STORE,
	MOIRAI_IDEMPOTENCY_STORE,
	MOIRAI_INBOX_STORE,
	MOIRAI_OPTIONS,
	MOIRAI_OUTBOX_STORE,
	MOIRAI_PROJECTION_STORAGE,
	Projection,
	Reactor,
	StoredEvent,
	Streams,
	UnknownStoredEventError,
	UnregisteredStreamClassError
} from './exports';

const Credits = t
	.Codec(t.String({ pattern: '^-?[0-9]+$' }))
	.Decode((value) => BigInt(value))
	.Encode((value: bigint) => value.toString());

const CreditsToppedUpData = t.Object({ topUpId: t.String(), credits: Credits });
@StoredEvent.register({ name: 'CreditsToppedUp', schema: CreditsToppedUpData })
class CreditsToppedUp extends StoredEvent<Static<typeof CreditsToppedUpData>> {}

const CreditsSpentData = t.Object({
	spendId: t.String(),
	purpose: t.Union([t.Literal('access'), t.Literal('gift')]),
	sellerId: t.String(),
	credits: Credits,
	ref: t.Record(t.String(), t.String())
});
type CreditsSpentV1 = { spendId: string; credits: string; ref: Record<string, string> };
type CreditsSpentV2 = CreditsSpentV1 & { purpose: 'access' | 'gift' };

@StoredEvent.register({ name: 'CreditsSpent', version: 3, schema: CreditsSpentData })
class CreditsSpent extends StoredEvent<Static<typeof CreditsSpentData>> {
	/** Version 1 only had gifts. */
	@StoredEvent.upcast(1)
	static fromV1(data: CreditsSpentV1): CreditsSpentV2 {
		return { ...data, purpose: 'gift' };
	}

	/** Version 2 kept the seller in `ref`. */
	@StoredEvent.upcast(2)
	static fromV2({ ref: { sellerId, ...ref }, ...data }: CreditsSpentV2) {
		return { ...data, sellerId, ref };
	}
}

@StoredEvent.register()
class Unrecorded extends StoredEvent<{ note: string }> {}

class InsufficientCredits extends DomainError.for('INSUFFICIENT_CREDITS', 422) {
	constructor(public readonly missing: bigint) {
		super(`${missing} credits are missing.`);
	}
}

type WalletState = { credits: bigint; spends: number };

@Aggregate.register({ name: 'wallet' })
class Wallet extends Aggregate<WalletState> {
	static override initialState: WalletState = { credits: 0n, spends: 0 };

	get balance(): bigint {
		return this.state.credits;
	}

	topUp(topUpId: string, credits: bigint) {
		this.record(new CreditsToppedUp({ topUpId, credits }));
	}

	spend(spendId: string, credits: bigint, sellerId = 'seller-1') {
		if (credits > this.state.credits) return new InsufficientCredits(credits - this.state.credits);
		this.record(new CreditsSpent({ spendId, purpose: 'gift', sellerId, credits, ref: {} }));
	}

	/** Two spends in one command, the second checked against the state after the first. */
	spendTwice(credits: bigint) {
		this.spend('a', credits);
		return this.spend('b', credits);
	}

	mutate() {
		(this.state as { credits: bigint }).credits = 1_000n;
	}

	recordUnregistered() {
		class Loose extends StoredEvent<{}> {}
		this.record(new Loose({}));
	}

	@Aggregate.evolve(CreditsToppedUp)
	protected toppedUp(state: WalletState, event: CreditsToppedUp): WalletState {
		return { ...state, credits: state.credits + event.data.credits };
	}

	@Aggregate.evolve(CreditsSpent)
	private spent(state: WalletState, event: CreditsSpent): WalletState {
		return { credits: state.credits - event.data.credits, spends: state.spends + 1 };
	}
}

const movements: { id: string; user: string; credits: bigint; replay: boolean }[] = [];
const published: { event: string; payload: unknown }[] = [];
let failProjection = false;

class WalletMovementModel {}

@Projection.inline({ name: 'wallet-movements', version: 2, models: [WalletMovementModel] })
class WalletMovements {
	@Projection.on(CreditsToppedUp)
	protected toppedUp(event: CreditsToppedUp, meta: StoredEventMeta) {
		movements.push({
			id: event.data.topUpId,
			user: meta.aggregateId,
			credits: event.data.credits,
			replay: meta.replay
		});
	}

	@Projection.on(CreditsSpent)
	protected spent(event: CreditsSpent, meta: StoredEventMeta) {
		if (failProjection) throw new Error('projection failed');
		movements.push({
			id: event.data.spendId,
			user: meta.aggregateId,
			credits: -event.data.credits,
			replay: meta.replay
		});
	}
}

class GiftReactor {
	@Reactor.on(CreditsSpent, { when: (event) => event.data.purpose === 'gift' })
	protected async gifted(event: CreditsSpent, meta: StoredEventMeta) {
		await Event.publish('CreditsGifted', {
			buyerId: meta.aggregateId,
			credits: event.data.credits.toString()
		});
		published.push({ event: 'CreditsGifted', payload: { buyerId: meta.aggregateId } });
	}
}

let events: MemoryEventStore;
let storage: MemoryProjectionStorage;
const resets: (readonly object[])[] = [];
let outbox: MemoryOutboxStore;
let transactions: string[];
let depth = 0;

beforeEach(() => {
	movements.length = 0;
	published.length = 0;
	failProjection = false;
	transactions = [];
	events = new MemoryEventStore();
	outbox = new MemoryOutboxStore();
	Service.instance(
		'db.transaction',
		withUnitOfWork(async (callback) => {
			if (depth > 0) return callback();
			depth++;
			transactions.push('BEGIN');
			try {
				const result = await callback();
				transactions.push('COMMIT');
				return result;
			} catch (error) {
				transactions.push('ROLLBACK');
				throw error;
			} finally {
				depth--;
			}
		})
	);
	Service.instance(MOIRAI_EVENT_STORE, events);
	resets.length = 0;
	storage = new MemoryProjectionStorage((models) => {
		resets.push(models);
		movements.length = 0;
	});
	Service.instance(MOIRAI_PROJECTION_STORAGE, storage);
	Service.instance(MOIRAI_OUTBOX_STORE, outbox);
	Service.instance(MOIRAI_INBOX_STORE, new MemoryInboxStore());
	Service.instance(MOIRAI_IDEMPOTENCY_STORE, new MemoryIdempotencyStore());
	Service.instance(MOIRAI_ACTION_LOCK, new MemoryLock());
	Service.instance(MOIRAI_OPTIONS, {
		...DEFAULT_OPTIONS_FOR_TESTS,
		relayOnCommit: false,
		eventMetadata: () => ({ actor: 'user:1', correlationId: 'req-1' })
	});
});

afterEach(() => {
	for (const name of [
		'db.transaction',
		MOIRAI_EVENT_STORE,
		MOIRAI_PROJECTION_STORAGE,
		MOIRAI_OUTBOX_STORE,
		MOIRAI_INBOX_STORE,
		MOIRAI_IDEMPOTENCY_STORE,
		MOIRAI_ACTION_LOCK,
		MOIRAI_OPTIONS
	]) {
		Service.remove(name);
	}
});

describe('StoredEvent', () => {
	it('refuses two classes with the same name', () => {
		expect(() => {
			@StoredEvent.register({ name: 'CreditsSpent' })
			class Twice extends StoredEvent<{}> {}
			return Twice;
		}).toThrow(DuplicateStreamNameError);
	});

	it('encodes the data with its schema, and decodes it back', async () => {
		await Streams.act(Wallet, 'u-1', (wallet) => wallet.topUp('t-1', 100n));
		expect(events.records[0]).toMatchObject({
			type: 'CreditsToppedUp',
			schemaVersion: 1,
			data: { topUpId: 't-1', credits: '100' }
		});
		expect((await Streams.retrieve(Wallet, 'u-1')).balance).toBe(100n);
	});

	it('refuses data that does not match its schema', async () => {
		const outcome = Streams.act(Wallet, 'u-1', (wallet) =>
			wallet.topUp('t-1', 'many' as never)
		).orError();
		expect(outcome).rejects.toThrow();
		expect(events.records).toHaveLength(0);
	});

	it('upcasts older versions, one after the other', async () => {
		const at = new Date();
		const base = { aggregateType: 'wallet', metadata: {}, occurredAt: at };
		await events.append([
			{
				...base,
				aggregateId: 'u-1',
				version: 1,
				type: 'CreditsToppedUp',
				schemaVersion: 1,
				data: { topUpId: 't', credits: '50' }
			},
			{
				...base,
				aggregateId: 'u-1',
				version: 2,
				type: 'CreditsSpent',
				schemaVersion: 1,
				data: { spendId: 's-1', credits: '10', ref: { sellerId: 'x' } }
			},
			{
				...base,
				aggregateId: 'u-1',
				version: 3,
				type: 'CreditsSpent',
				schemaVersion: 2,
				data: { spendId: 's-2', purpose: 'access', credits: '5', ref: { sellerId: 'y', item: 'i' } }
			}
		]);
		const wallet = await Streams.retrieve(Wallet, 'u-1');
		expect(wallet.balance).toBe(35n);
		expect(wallet.version).toBe(3);
	});

	it('refuses a type or a version it cannot read', async () => {
		await events.append([
			{
				aggregateId: 'u-1',
				aggregateType: 'wallet',
				version: 1,
				type: 'CreditsSpent',
				schemaVersion: 4,
				data: {},
				metadata: {},
				occurredAt: new Date()
			}
		]);
		expect(Streams.retrieve(Wallet, 'u-1')).rejects.toThrow(UnknownStoredEventError);
	});

	it('freezes its data in development and test', () => {
		const event = new CreditsToppedUp({ topUpId: 't', credits: 1n });
		expect(() => ((event.data as { credits: bigint }).credits = 2n)).toThrow(TypeError);
	});
});

describe('Aggregate', () => {
	it('records events and applies them at once', () => {
		Wallet.given([new CreditsToppedUp({ topUpId: 't', credits: 100n })])
			.when((wallet) => wallet.spendTwice(40n))
			.assertRecorded(
				new CreditsSpent({
					spendId: 'a',
					purpose: 'gift',
					sellerId: 'seller-1',
					credits: 40n,
					ref: {}
				}),
				CreditsSpent
			);
	});

	it('returns the DomainError that refuses a command', () => {
		const scenario = Wallet.given([new CreditsToppedUp({ topUpId: 't', credits: 10n })])
			.when((wallet) => wallet.spend('s', 30n))
			.assertRefused(InsufficientCredits);
		expect((scenario.outcome as InsufficientCredits).missing).toBe(20n);
	});

	it('fails an assertion that does not hold', () => {
		const scenario = Wallet.given().when((wallet) => wallet.topUp('t', 1n));
		expect(() => scenario.assertNothingRecorded()).toThrow('Expected the events []');
		expect(() =>
			scenario.assertRecorded(new CreditsToppedUp({ topUpId: 't', credits: 2n }))
		).toThrow();
		expect(() => scenario.assertRefused(InsufficientCredits)).toThrow();
	});

	it('freezes its state in development and test', () => {
		expect(() => Wallet.given().when((wallet) => wallet.mutate())).toThrow(TypeError);
	});

	it('refuses an event class without @StoredEvent.register()', () => {
		expect(() => Wallet.given().when((wallet) => wallet.recordUnregistered())).toThrow(
			UnregisteredStreamClassError
		);
	});

	it('refuses two classes with the same name, and a class without its decorator', async () => {
		expect(() => {
			@Aggregate.register({ name: 'wallet' })
			class Twice extends Aggregate {}
			return Twice;
		}).toThrow(DuplicateStreamNameError);
		class Loose extends Aggregate {}
		expect(Streams.retrieve(Loose, 'x')).rejects.toThrow(UnregisteredStreamClassError);
	});
});

describe('Streams.act', () => {
	it('appends at the next versions with the metadata, and runs projections and reactors in the unit of work', async () => {
		await Streams.act(Wallet, 'u-1', (wallet) => wallet.topUp('t-1', 100n));
		const outcome = await Streams.act(Wallet, 'u-1', (wallet) => wallet.spendTwice(30n), {
			metadata: { causationId: 'c-1' }
		}).orThrow();

		expect(outcome.aggregate.balance).toBe(40n);
		expect(outcome.aggregate.version).toBe(3);
		expect(outcome.of(CreditsSpent).map((event) => event.data.spendId)).toEqual(['a', 'b']);
		expect(events.records.map((record) => [record.type, record.version])).toEqual([
			['CreditsToppedUp', 1],
			['CreditsSpent', 2],
			['CreditsSpent', 3]
		]);
		expect(events.records[1]!.metadata).toEqual({
			actor: 'user:1',
			correlationId: 'req-1',
			causationId: 'c-1'
		});
		expect(movements.map((m) => [m.id, m.credits])).toEqual([
			['t-1', 100n],
			['a', -30n],
			['b', -30n]
		]);
		expect(outbox.rows).toHaveLength(0); // no handler of CreditsGifted is registered
		expect(published).toHaveLength(2);
		expect(transactions).toEqual(['BEGIN', 'COMMIT', 'BEGIN', 'COMMIT']);
	});

	it('appends nothing when the command is refused, and fails with its error', async () => {
		const outcome = await Streams.act(Wallet, 'u-1', (wallet) => wallet.spend('s', 5n));
		expect(outcome.check()).toBe(false);
		expect(outcome.error).toBeInstanceOf(InsufficientCredits);
		expect(events.records).toHaveLength(0);
		expect(movements).toHaveLength(0);
	});

	it('takes a Result from the command', async () => {
		await Streams.act(Wallet, 'u-1', (wallet) => wallet.topUp('t-1', 100n));
		const spend = (wallet: Wallet, credits: bigint) =>
			Result.of(wallet.spend(`s-${credits}`, credits)).map(() => wallet.balance);

		const passed = await Streams.act(Wallet, 'u-1', (wallet) => spend(wallet, 30n));
		expect(passed.check() && passed.result.value).toBe(70n);
		expect(events.records).toHaveLength(2);

		const failed = await Streams.act(Wallet, 'u-1', (wallet) => spend(wallet, 500n));
		expect(failed.error).toBeInstanceOf(InsufficientCredits);
		expect(events.records).toHaveLength(2);
	});

	it('rolls the events back when a projection fails', async () => {
		await Streams.act(Wallet, 'u-1', (wallet) => wallet.topUp('t-1', 100n));
		failProjection = true;
		expect(Streams.act(Wallet, 'u-1', (wallet) => wallet.spend('s', 5n)).orError()).rejects.toThrow(
			'projection failed'
		);
		await Bun.sleep(0);
		expect(events.records).toHaveLength(1);
	});

	it('rejects a stale append with a ConcurrencyConflictError, which an action retries', async () => {
		await Streams.act(Wallet, 'u-1', (wallet) => wallet.topUp('t-1', 100n));
		await Streams.act(Wallet, 'u-1', (wallet) => wallet.topUp('t-2', 100n));
		// The first load misses the last event, as if another writer appended it meanwhile.
		const load = events.load.bind(events);
		let stale = true;
		events.load = async (id, after) => {
			const records = await load(id, after);
			if (!stale) return records;
			stale = false;
			return records.slice(0, -1);
		};
		let attempts = 0;

		@Action.register({ errors: [InsufficientCredits], name: 'wallet.spend' })
		class SpendAction extends Action<undefined, bigint> {
			override async handle() {
				attempts++;
				const outcome = await Streams.act(Wallet, 'u-1', (wallet) =>
					wallet.spend('s', 10n)
				).orError();
				if (isDomainError(outcome)) return outcome;
				return outcome.aggregate.balance;
			}
		}

		expect(await Moirai.execute(SpendAction).orError()).toBe(190n);
		expect(attempts).toBe(2);
		expect(events.records.map((record) => record.version)).toEqual([1, 2, 3]);
	});

	it('gives the conflict to a caller outside an action', async () => {
		await Streams.act(Wallet, 'u-1', (wallet) => wallet.topUp('t-1', 100n));
		expect(
			Streams.act(Wallet, 'u-1', async (wallet) => {
				await events.append([{ ...events.records[0]!, version: 2 }]);
				wallet.topUp('t-2', 1n);
			}).orError()
		).rejects.toThrow(ConcurrencyConflictError);
	});
});

describe('Projection.project', () => {
	it('runs the handlers of a projection for given events', async () => {
		await Projection.project(WalletMovements, [
			[new CreditsToppedUp({ topUpId: 't', credits: 5n }), { aggregateId: 'u-9', replay: true }]
		]);
		expect(movements).toEqual([{ id: 't', user: 'u-9', credits: 5n, replay: true }]);
	});
});

describe('Projection.rebuild', () => {
	it('resets the models and replays the events it handles, in log order, without reactors', async () => {
		await Streams.act(Wallet, 'u-1', (wallet) => wallet.topUp('t-1', 100n));
		await Streams.act(Wallet, 'u-2', (wallet) => wallet.topUp('t-2', 50n));
		await Streams.act(Wallet, 'u-1', (wallet) => wallet.spend('s-1', 30n));
		published.length = 0;
		movements.push({ id: 'stale', user: 'u-0', credits: 1n, replay: false });

		expect(await Projection.stale()).toEqual(['wallet-movements']);
		expect(await Projection.rebuild('wallet-movements', { batch: 2 })).toBe(3);

		expect(resets).toEqual([[WalletMovementModel]]);
		expect(movements).toEqual([
			{ id: 't-1', user: 'u-1', credits: 100n, replay: true },
			{ id: 't-2', user: 'u-2', credits: 50n, replay: true },
			{ id: 's-1', user: 'u-1', credits: -30n, replay: true }
		]);
		expect(published).toHaveLength(0);
		expect(await storage.version('wallet-movements')).toBe(2);
		expect(await Projection.stale()).toEqual([]);
		expect(transactions.at(-1)).toBe('COMMIT');
	});

	it('keeps the previous version when the rebuild fails', async () => {
		await Streams.act(Wallet, 'u-1', (wallet) => wallet.topUp('t-1', 100n));
		await Streams.act(Wallet, 'u-1', (wallet) => wallet.spend('s-1', 30n));
		failProjection = true;
		expect(Projection.rebuild(WalletMovements)).rejects.toThrow('projection failed');
		await Bun.sleep(0);
		expect(await storage.version('wallet-movements')).toBeUndefined();
	});

	it('lists the projections and refuses an unknown one', () => {
		expect(Projection.all().map(({ name, version }) => [name, version])).toEqual([
			['wallet-movements', 2]
		]);
		expect(() => Projection.rebuild('nope')).toThrow('No projection is named "nope".');
		class Loose {}
		expect(() => Projection.rebuild(Loose)).toThrow(
			'Loose is not marked with @Projection.inline().'
		);
	});
});

void Unrecorded;
void GiftReactor;
