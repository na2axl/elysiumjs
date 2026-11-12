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

import { ConflictError, DomainError, NotFoundError, t } from '@elysiumjs/core';
import { describe, expect, it } from 'bun:test';

import {
	Action,
	CallForbiddenError,
	IdempotencyKeyRequiredError,
	IdempotencyKeyReusedError,
	InvalidInputError,
	Query
} from './exports';

class WalletClosed extends DomainError.for('WALLET_CLOSED', 409) {}

const Receipt = t.Object({ balance: t.Integer() });

@Action.register({
	input: t.Object({ amount: t.Integer() }),
	idempotent: true,
	result: Receipt,
	errors: [WalletClosed]
})
class Pay extends Action<{ amount: number }, { balance: number }, WalletClosed> {
	public handle(input: { amount: number }) {
		return input.amount > 10 ? new WalletClosed() : { balance: input.amount };
	}
}

@Query.register({ result: t.Array(Receipt), errors: [NotFoundError], authorize: () => true })
class Receipts extends Query<void, { balance: number }[], NotFoundError> {
	public handle() {
		return [];
	}
}

@Action.register({ errors: [] })
class Ping extends Action<void, string, never> {
	public handle() {
		return 'pong';
	}
}

describe('action and query contracts', () => {
	it('give back the result schema of the registration', () => {
		expect(Pay.result).toBe(Receipt);
		expect((Receipts.result as any).type).toBe('array');
		expect(Ping.result).toBeUndefined();
	});

	it('list their errors, then those moirai answers with', () => {
		expect(Pay.errors).toEqual([
			WalletClosed,
			InvalidInputError,
			IdempotencyKeyRequiredError,
			IdempotencyKeyReusedError
		]);
		expect(Receipts.errors).toEqual([NotFoundError, CallForbiddenError]);
		expect(Ping.errors).toEqual([]);
	});

	it('describe the problems of moirai', () => {
		expect((InvalidInputError.schema as any).properties.errors.type).toBe('array');
		expect((IdempotencyKeyReusedError.schema as any).properties.idempotencyKey.type).toBe('string');
	});

	it('check that the errors list what handle() gives', () => {
		// @ts-expect-error - handle() also gives ConflictError.
		@Action.register({ errors: [WalletClosed] })
		class Unlisted extends Action<void, string, WalletClosed | ConflictError> {
			public handle() {
				return new ConflictError();
			}
		}
		expect(Unlisted.errors).toEqual([WalletClosed]);
	});
});
