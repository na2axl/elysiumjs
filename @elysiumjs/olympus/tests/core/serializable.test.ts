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

import {
	DomainError,
	DuplicateSerializerError,
	ForbiddenError,
	Json,
	Serializable
} from '../../src/index';

@Serializable({ name: 'test.serializable.declined' })
class Declined extends DomainError.for('PAYMENT_DECLINED', 402) {
	constructor(reason: string) {
		super('Card refused.', { extensions: { reason }, retryAfterSeconds: 30 });
	}
}

@Serializable({ name: 'test.serializable.money' })
class Money {
	constructor(
		readonly amount: bigint,
		readonly currency: string,
		readonly note?: string
	) {}

	public format(): string {
		return `${this.amount} ${this.currency}`;
	}
}

class Unlisted extends DomainError.for('PAYMENT_DECLINED', 402) {}

const roundTrip = <T>(value: T): T => Json.parse<T>(Json.stringify(value));

describe('Serializable', () => {
	it('gives a class instance back on its prototype, with its fields', () => {
		const back = roundTrip({ price: new Money(1500n, 'XAF'), at: new Date(0) });
		expect(back.price).toBeInstanceOf(Money);
		expect(back.price.amount).toBe(1500n);
		expect(back.price.format()).toBe('1500 XAF');
		expect(back.price).not.toHaveProperty('note');
		expect(back.at).toBeInstanceOf(Date);
		expect(Json.survives(new Money(1n, 'XAF'))).toBe(true);
	});

	it('gives a DomainError back with its class and problem', () => {
		const back = roundTrip([new Declined('expired')])[0]!;
		expect(back).toBeInstanceOf(Declined);
		expect(back).toBeInstanceOf(DomainError);
		expect(back).toMatchObject({
			code: 'PAYMENT_DECLINED',
			status: 402,
			name: 'Declined',
			detail: 'Card refused.',
			extensions: { reason: 'expired' },
			retryAfterSeconds: 30,
			headers: { 'retry-after': '30' }
		});
		expect(back.message).toBe('Card refused.');
	});

	it('matches its class only, not a class with the same code', () => {
		const back = roundTrip(new Unlisted('Nope.'));
		expect(back).not.toBeInstanceOf(Unlisted);
		expect(back).not.toBeInstanceOf(Declined);
		expect(back).toBeInstanceOf(DomainError);
		expect(back).toMatchObject({ code: 'PAYMENT_DECLINED', status: 402, detail: 'Nope.' });
	});

	it('gives other errors back as plain ones', () => {
		const forbidden = roundTrip(new ForbiddenError('No.'));
		expect(forbidden).toBeInstanceOf(DomainError);
		expect(forbidden).toMatchObject({ code: 'FORBIDDEN', status: 403, message: 'No.' });
		const error = roundTrip(new TypeError('boom'));
		expect(error).toBeInstanceOf(Error);
		expect(error).toMatchObject({ name: 'TypeError', message: 'boom' });
	});

	it('refuses a name another class has, and tells serializable classes apart', () => {
		class Other {}
		expect(() => Serializable({ name: 'test.serializable.money' })(Other)).toThrow(
			DuplicateSerializerError
		);
		expect(Serializable.has(Money)).toBe(true);
		expect(Serializable.has(Other)).toBe(false);
	});
});
