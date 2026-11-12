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

import { describe, expect, it } from 'bun:test';

import { Json } from '../../src/json';
import {
	DateSerializer,
	DuplicateSerializerError,
	Serializer,
	UnknownSerializerError
} from '../../src/serializer';

class Money {
	constructor(
		public readonly amount: bigint,
		public readonly currency: string
	) {}
}

@Serializer.register({ name: 'test.money' })
class MoneySerializer extends Serializer<Money, { amount: string; currency: string }> {
	public supports(value: unknown) {
		return value instanceof Money;
	}

	public serialize(money: Money) {
		return { amount: money.amount.toString(), currency: money.currency };
	}

	public deserialize(value: { amount: string; currency: string }) {
		return new Money(BigInt(value.amount), value.currency);
	}
}

class Slot {
	constructor(
		public readonly from: Date,
		public readonly to: Date
	) {}
}

// Its serialized form holds dates, which are written with Json again.
@Serializer.register({ name: 'test.slot' })
class SlotSerializer extends Serializer<Slot, { from: Date; to: Date }> {
	public supports(value: unknown) {
		return value instanceof Slot;
	}

	public serialize(slot: Slot) {
		return { from: slot.from, to: slot.to };
	}

	public deserialize(value: { from: Date; to: Date }) {
		return new Slot(value.from, value.to);
	}
}

describe('Json', () => {
	it('keeps dates at any depth', () => {
		const value = { at: new Date('2026-01-01T00:00:00Z'), list: [{ due: new Date(0) }], n: 1 };
		const text = Json.stringify(value);
		expect(JSON.parse(text)).toEqual({
			at: { $type: 'date', $value: '2026-01-01T00:00:00.000Z' },
			list: [{ due: { $type: 'date', $value: '1970-01-01T00:00:00.000Z' } }],
			n: 1
		});
		expect(Json.parse(text)).toEqual(value);
	});

	it('escapes plain objects that look like tags', () => {
		const value = {
			a: { $type: 'date', $value: 'not a date' },
			b: { $escaped: { x: 1 } },
			c: { $type: 'date', $value: 1, more: true }
		};
		expect(Json.parse(Json.stringify(value))).toEqual(value);
	});

	it('writes the values of registered serializers, and reads them back', () => {
		const price = new Money(1200n, 'EUR');
		const slot = new Slot(new Date('2026-01-01T09:00:00Z'), new Date('2026-01-01T10:00:00Z'));
		const back = Json.parse<{ price: Money; slot: Slot; big: bigint }>(
			Json.stringify({ price, slot, big: 2n ** 70n })
		);
		expect(back.price).toBeInstanceOf(Money);
		expect(back.price).toEqual(price);
		expect(back.slot).toBeInstanceOf(Slot);
		expect(back.slot.from).toBeInstanceOf(Date);
		expect(back.slot).toEqual(slot);
		expect(back.big).toBe(2n ** 70n);
		expect(Json.encode(slot)).toEqual({
			$type: 'test.slot',
			$value: {
				from: { $type: 'date', $value: '2026-01-01T09:00:00.000Z' },
				to: { $type: 'date', $value: '2026-01-01T10:00:00.000Z' }
			}
		});
	});

	it('keeps maps, sets and bigints, with what they hold', () => {
		const value = {
			byDay: new Map<unknown, unknown>([
				[new Date('2026-01-01T00:00:00Z'), new Set(['a', 'b'])],
				['total', 2n ** 70n]
			]),
			tags: new Set([1, { nested: new Map([['k', new Date(0)]]) }])
		};
		const text = Json.stringify(value);
		expect(JSON.parse(text).tags).toEqual({
			$type: 'set',
			$value: [
				1,
				{
					nested: {
						$type: 'map',
						$value: [['k', { $type: 'date', $value: '1970-01-01T00:00:00.000Z' }]]
					}
				}
			]
		});
		const back = Json.parse<typeof value>(text);
		expect(back).toEqual(value);
		expect(back.byDay).toBeInstanceOf(Map);
		expect([...back.byDay.keys()][0]).toBeInstanceOf(Date);
		expect(back.byDay.get('total')).toBe(2n ** 70n);
		expect(Json.survives(value)).toBe(true);
		class Registry extends Map {}
		expect(Json.survives(new Registry())).toBe(false);
		expect(Json.survives(new Map([['f', () => 1]]))).toBe(false);
	});

	it('refuses a value that names an unknown serializer', () => {
		expect(() => Json.parse('{"$type":"test.missing","$value":1}')).toThrow(UnknownSerializerError);
	});

	it('asks serializers by priority, highest first', () => {
		@Serializer.register({ name: 'test.epoch', priority: 10 })
		class EpochSerializer extends Serializer<Date, number> {
			public supports(value: unknown) {
				return value instanceof Date;
			}

			public serialize(value: Date) {
				return value.getTime();
			}

			public deserialize(value: number) {
				return new Date(value);
			}
		}
		try {
			expect(Json.encode(new Date(5))).toEqual({ $type: 'test.epoch', $value: 5 });
			// A value written by the date serializer still reads back.
			expect(Json.parse('{"$type":"date","$value":"1970-01-01T00:00:00.005Z"}')).toEqual(
				new Date(5)
			);
		} finally {
			const all = Serializer.all() as { serializer: Serializer }[];
			all.splice(
				all.findIndex((entry) => entry.serializer instanceof EpochSerializer),
				1
			);
		}
		expect(Serializer.for(new Date())?.serializer).toBeInstanceOf(DateSerializer);
	});

	it('refuses a second class with the same name', () => {
		expect(() => {
			@Serializer.register({ name: 'test.money' })
			class Other extends MoneySerializer {}
			return Other;
		}).toThrow(DuplicateSerializerError);
	});

	it('tells whether a value comes back as it was', () => {
		expect(Json.survives({ at: new Date(), tags: ['a'], n: null })).toBe(true);
		expect(Json.survives({ price: new Money(1n, 'EUR'), big: 1n })).toBe(true);
		expect(Json.survives({ weak: new WeakMap() })).toBe(false);
		expect(Json.survives({ fn: () => 1 })).toBe(false);
		expect(Json.survives([undefined])).toBe(false);
		expect(Json.survives(undefined)).toBe(false);
		expect(Json.survives({ n: Number.NaN })).toBe(false);
		expect(Json.survives(new Date(Number.NaN))).toBe(false);
		const cycle: Record<string, unknown> = {};
		cycle.self = cycle;
		expect(Json.survives(cycle)).toBe(false);
		const shared = { x: 1 };
		expect(Json.survives([shared, shared])).toBe(true);
	});
});

export const serializers = [MoneySerializer, SlotSerializer];
