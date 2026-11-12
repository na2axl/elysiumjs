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

const Klaps = t
	.Codec(t.String({ pattern: '^-?[0-9]+$' }))
	.Decode((value) => BigInt(value))
	.Encode((value: bigint) => value.toString());

const KlapsToppedUpData = t.Object({ topUpId: t.String(), klaps: Klaps });
@StoredEvent.register({ name: 'KlapsToppedUp', schema: KlapsToppedUpData })
class KlapsToppedUp extends StoredEvent<Static<typeof KlapsToppedUpData>> {}

const KlapsSpentData = t.Object({
	spendId: t.String(),
	purpose: t.Union([t.Literal('access'), t.Literal('gift')]),
	sellerId: t.String(),
	klaps: Klaps,
	ref: t.Record(t.String(), t.String())
});
type KlapsSpentV1 = { spendId: string; klaps: string; ref: Record<string, string> };
type KlapsSpentV2 = KlapsSpentV1 & { purpose: 'access' | 'gift' };

@StoredEvent.register({ name: 'KlapsSpent', version: 3, schema: KlapsSpentData })
class KlapsSpent extends StoredEvent<Static<typeof KlapsSpentData>> {
	/** Version 1 only had gifts. */
	@StoredEvent.upcast(1)
	static fromV1(data: KlapsSpentV1): KlapsSpentV2 {
		return { ...data, purpose: 'gift' };
	}

	/** Version 2 kept the seller in `ref`. */
	@StoredEvent.upcast(2)
	static fromV2({ ref: { sellerId, ...ref }, ...data }: KlapsSpentV2) {
		return { ...data, sellerId, ref };
	}
}

@StoredEvent.register()
class Unrecorded extends StoredEvent<{ note: string }> {}

class InsufficientKlaps extends DomainError.for('INSUFFICIENT_KLAPS', 422) {
	constructor(public readonly missing: bigint) {
		super(`${missing} klaps are missing.`);
	}
}

type WalletState = { klaps: bigint; spends: number };

@Aggregate.register({ name: 'wallet' })
class Wallet extends Aggregate<WalletState> {
	static override initialState: WalletState = { klaps: 0n, spends: 0 };

	get balance(): bigint {
		return this.state.klaps;
	}

	topUp(topUpId: string, klaps: bigint) {
		this.record(new KlapsToppedUp({ topUpId, klaps }));
	}

	spend(spendId: string, klaps: bigint, sellerId = 'seller-1') {
		if (klaps > this.state.klaps) return new InsufficientKlaps(klaps - this.state.klaps);
		this.record(new KlapsSpent({ spendId, purpose: 'gift', sellerId, klaps, ref: {} }));
	}

	/** Two spends in one command, the second checked against the state after the first. */
	spendTwice(klaps: bigint) {
		this.spend('a', klaps);
		return this.spend('b', klaps);
	}

	mutate() {
		(this.state as { klaps: bigint }).klaps = 1_000n;
	}

	recordUnregistered() {
		class Loose extends StoredEvent<{}> {}
		this.record(new Loose({}));
	}

	@Aggregate.evolve(KlapsToppedUp)
	protected toppedUp(state: WalletState, event: KlapsToppedUp): WalletState {
		return { ...state, klaps: state.klaps + event.data.klaps };
	}

	@Aggregate.evolve(KlapsSpent)
	private spent(state: WalletState, event: KlapsSpent): WalletState {
		return { klaps: state.klaps - event.data.klaps, spends: state.spends + 1 };
	}
}

const movements: { id: string; user: string; klaps: bigint; replay: boolean }[] = [];
const published: { event: string; payload: unknown }[] = [];
let failProjection = false;

class WalletMovementModel {}

@Projection.inline({ name: 'wallet-movements', version: 2, models: [WalletMovementModel] })
class WalletMovements {
	@Projection.on(KlapsToppedUp)
	protected toppedUp(event: KlapsToppedUp, meta: StoredEventMeta) {
		movements.push({
			id: event.data.topUpId,
			user: meta.aggregateId,
			klaps: event.data.klaps,
			replay: meta.replay
		});
	}

	@Projection.on(KlapsSpent)
	protected spent(event: KlapsSpent, meta: StoredEventMeta) {
		if (failProjection) throw new Error('projection failed');
		movements.push({
			id: event.data.spendId,
			user: meta.aggregateId,
			klaps: -event.data.klaps,
			replay: meta.replay
		});
	}
}

class GiftReactor {
	@Reactor.on(KlapsSpent, { when: (event) => event.data.purpose === 'gift' })
	protected async gifted(event: KlapsSpent, meta: StoredEventMeta) {
		await Event.publish('KlapsGifted', {
			buyerId: meta.aggregateId,
			klaps: event.data.klaps.toString()
		});
		published.push({ event: 'KlapsGifted', payload: { buyerId: meta.aggregateId } });
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
			@StoredEvent.register({ name: 'KlapsSpent' })
			class Twice extends StoredEvent<{}> {}
			return Twice;
		}).toThrow(DuplicateStreamNameError);
	});

	it('encodes the data with its schema, and decodes it back', async () => {
		await Streams.act(Wallet, 'u-1', (wallet) => wallet.topUp('t-1', 100n));
		expect(events.records[0]).toMatchObject({
			type: 'KlapsToppedUp',
			schemaVersion: 1,
			data: { topUpId: 't-1', klaps: '100' }
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
				type: 'KlapsToppedUp',
				schemaVersion: 1,
				data: { topUpId: 't', klaps: '50' }
			},
			{
				...base,
				aggregateId: 'u-1',
				version: 2,
				type: 'KlapsSpent',
				schemaVersion: 1,
				data: { spendId: 's-1', klaps: '10', ref: { sellerId: 'x' } }
			},
			{
				...base,
				aggregateId: 'u-1',
				version: 3,
				type: 'KlapsSpent',
				schemaVersion: 2,
				data: { spendId: 's-2', purpose: 'access', klaps: '5', ref: { sellerId: 'y', item: 'i' } }
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
				type: 'KlapsSpent',
				schemaVersion: 4,
				data: {},
				metadata: {},
				occurredAt: new Date()
			}
		]);
		expect(Streams.retrieve(Wallet, 'u-1')).rejects.toThrow(UnknownStoredEventError);
	});

	it('freezes its data in development and test', () => {
		const event = new KlapsToppedUp({ topUpId: 't', klaps: 1n });
		expect(() => ((event.data as { klaps: bigint }).klaps = 2n)).toThrow(TypeError);
	});
});

describe('Aggregate', () => {
	it('records events and applies them at once', () => {
		Wallet.given([new KlapsToppedUp({ topUpId: 't', klaps: 100n })])
			.when((wallet) => wallet.spendTwice(40n))
			.assertRecorded(
				new KlapsSpent({
					spendId: 'a',
					purpose: 'gift',
					sellerId: 'seller-1',
					klaps: 40n,
					ref: {}
				}),
				KlapsSpent
			);
	});

	it('returns the DomainError that refuses a command', () => {
		const scenario = Wallet.given([new KlapsToppedUp({ topUpId: 't', klaps: 10n })])
			.when((wallet) => wallet.spend('s', 30n))
			.assertRefused(InsufficientKlaps);
		expect((scenario.outcome as InsufficientKlaps).missing).toBe(20n);
	});

	it('fails an assertion that does not hold', () => {
		const scenario = Wallet.given().when((wallet) => wallet.topUp('t', 1n));
		expect(() => scenario.assertNothingRecorded()).toThrow('Expected the events []');
		expect(() => scenario.assertRecorded(new KlapsToppedUp({ topUpId: 't', klaps: 2n }))).toThrow();
		expect(() => scenario.assertRefused(InsufficientKlaps)).toThrow();
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
		expect(outcome.of(KlapsSpent).map((event) => event.data.spendId)).toEqual(['a', 'b']);
		expect(events.records.map((record) => [record.type, record.version])).toEqual([
			['KlapsToppedUp', 1],
			['KlapsSpent', 2],
			['KlapsSpent', 3]
		]);
		expect(events.records[1]!.metadata).toEqual({
			actor: 'user:1',
			correlationId: 'req-1',
			causationId: 'c-1'
		});
		expect(movements.map((m) => [m.id, m.klaps])).toEqual([
			['t-1', 100n],
			['a', -30n],
			['b', -30n]
		]);
		expect(outbox.rows).toHaveLength(0); // no handler of KlapsGifted is registered
		expect(published).toHaveLength(2);
		expect(transactions).toEqual(['BEGIN', 'COMMIT', 'BEGIN', 'COMMIT']);
	});

	it('appends nothing when the command is refused, and fails with its error', async () => {
		const outcome = await Streams.act(Wallet, 'u-1', (wallet) => wallet.spend('s', 5n));
		expect(outcome.check()).toBe(false);
		expect(outcome.error).toBeInstanceOf(InsufficientKlaps);
		expect(events.records).toHaveLength(0);
		expect(movements).toHaveLength(0);
	});

	it('takes a Result from the command', async () => {
		await Streams.act(Wallet, 'u-1', (wallet) => wallet.topUp('t-1', 100n));
		const spend = (wallet: Wallet, klaps: bigint) =>
			Result.of(wallet.spend(`s-${klaps}`, klaps)).map(() => wallet.balance);

		const passed = await Streams.act(Wallet, 'u-1', (wallet) => spend(wallet, 30n));
		expect(passed.check() && passed.result.value).toBe(70n);
		expect(events.records).toHaveLength(2);

		const failed = await Streams.act(Wallet, 'u-1', (wallet) => spend(wallet, 500n));
		expect(failed.error).toBeInstanceOf(InsufficientKlaps);
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

		@Action.register({ errors: [InsufficientKlaps], name: 'wallet.spend' })
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
			[new KlapsToppedUp({ topUpId: 't', klaps: 5n }), { aggregateId: 'u-9', replay: true }]
		]);
		expect(movements).toEqual([{ id: 't', user: 'u-9', klaps: 5n, replay: true }]);
	});
});

describe('Projection.rebuild', () => {
	it('resets the models and replays the events it handles, in log order, without reactors', async () => {
		await Streams.act(Wallet, 'u-1', (wallet) => wallet.topUp('t-1', 100n));
		await Streams.act(Wallet, 'u-2', (wallet) => wallet.topUp('t-2', 50n));
		await Streams.act(Wallet, 'u-1', (wallet) => wallet.spend('s-1', 30n));
		published.length = 0;
		movements.push({ id: 'stale', user: 'u-0', klaps: 1n, replay: false });

		expect(await Projection.stale()).toEqual(['wallet-movements']);
		expect(await Projection.rebuild('wallet-movements', { batch: 2 })).toBe(3);

		expect(resets).toEqual([[WalletMovementModel]]);
		expect(movements).toEqual([
			{ id: 't-1', user: 'u-1', klaps: 100n, replay: true },
			{ id: 't-2', user: 'u-2', klaps: 50n, replay: true },
			{ id: 's-1', user: 'u-1', klaps: -30n, replay: true }
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
