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

import { ConflictError, Service } from '@elysiumjs/core';
import { Transactional, UnitOfWork, withUnitOfWork } from '@elysiumjs/mnemosyne';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as d from 'drizzle-orm/pg-core';

import { Database } from '../src/database';
import { DrizzleModel } from '../src/model';
import { DrizzleRepository } from '../src/repository';
import { pgTable } from '../src/table';
import { fakeConnection } from './fake-sql';

const accounts = pgTable('uow_accounts', {
	id: d.integer().primaryKey(),
	balance: d.integer().notNull()
});

class Account extends DrizzleModel(accounts) {}
class AccountRepository extends DrizzleRepository(Account) {}

describe('units of work', () => {
	let fake: ReturnType<typeof fakeConnection>;
	const events: string[] = [];

	beforeEach(() => {
		fake = fakeConnection((query) => (query.startsWith('update') ? [{ id: 1, balance: 0 }] : []));
		Service.instance('db.connection.default', fake.connection);
		Service.instance(
			'db.transaction',
			withUnitOfWork((callback, connection) => Database.transaction(() => callback(), connection))
		);
		events.length = 0;
	});

	afterEach(() => {
		Service.remove('db.connection.default');
		Service.remove('db.transaction');
	});

	const timeline = () => [
		...fake.log.map(({ client, query }) =>
			query === 'BEGIN' || query === 'COMMIT' || query === 'ROLLBACK'
				? query
				: `${client}:${query.split(' ')[0]}`
		)
	];

	it('runs repository calls in one transaction, nested units joining it', async () => {
		const repository = new AccountRepository();

		await UnitOfWork.run(async () => {
			await repository.update(1, { balance: 0 });
			await UnitOfWork.run(() => repository.update(2, { balance: 10 }));
		});

		expect(timeline()).toEqual(['BEGIN', 'tx:update', 'tx:update', 'COMMIT']);
	});

	it('runs afterCommit hooks once the outermost unit has committed', async () => {
		await UnitOfWork.run(async () => {
			await UnitOfWork.run(async () => {
				await UnitOfWork.afterCommit(
					() => void events.push(`published after ${timeline().at(-1)}`)
				);
			});
			expect(UnitOfWork.active()).toBe(true);
			events.push('inner done');
		});

		expect(events).toEqual(['inner done', 'published after COMMIT']);
	});

	it('runs afterRollback hooks, and no afterCommit hook, when the unit fails', async () => {
		const failing = UnitOfWork.run(async () => {
			await UnitOfWork.afterCommit(() => void events.push('committed'));
			UnitOfWork.afterRollback(() => void events.push('rolled back'));
			throw new Error('declined');
		});

		await expect(failing).rejects.toThrow('declined');
		expect(timeline()).toEqual(['BEGIN', 'ROLLBACK']);
		expect(events).toEqual(['rolled back']);
	});

	it('runs afterCommit hooks right away outside a unit of work', async () => {
		expect(UnitOfWork.active()).toBe(false);
		await UnitOfWork.afterCommit(() => void events.push('now'));
		UnitOfWork.afterRollback(() => void events.push('never'));

		expect(events).toEqual(['now']);
	});

	it('runs @Transactional methods in a unit of work', async () => {
		class TransferService {
			public readonly accounts = new AccountRepository();

			@Transactional()
			public async transfer() {
				await this.accounts.update(1, { balance: 0 });
				await this.accounts.update(2, { balance: 10 });
				return 'done';
			}
		}

		expect(await new TransferService().transfer()).toBe('done');
		expect(timeline()).toEqual(['BEGIN', 'tx:update', 'tx:update', 'COMMIT']);
	});

	it('rolls back a unit, or a @Transactional method, that returns a DomainError, and returns it', async () => {
		const repository = new AccountRepository();
		const outcome = await UnitOfWork.run(async () => {
			UnitOfWork.afterRollback(() => void events.push('rolled back'));
			await repository.update(1, { balance: 0 });
			// A joined unit hands the error up; the outermost one rolls back when it returns it.
			return UnitOfWork.run(async () => new ConflictError('taken'));
		});

		expect(outcome).toBeInstanceOf(ConflictError);
		expect(timeline()).toEqual(['BEGIN', 'tx:update', 'ROLLBACK']);
		expect(events).toEqual(['rolled back']);

		class Refuser {
			@Transactional()
			public async refuse() {
				return new ConflictError('no');
			}
		}
		expect(await new Refuser().refuse()).toBeInstanceOf(ConflictError);
		expect(timeline().slice(-2)).toEqual(['BEGIN', 'ROLLBACK']);
	});
});
