// Copyright (c) 2025-present Workbud Technologies Inc. All rights reserved.
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

import { Application, Service, ServiceNotFoundError } from '@elysiumjs/core';
import { afterEach, describe, expect, it, jest, mock, spyOn } from 'bun:test';

import { AbstractDatabase } from '../src/database';

const mockDriver = {
	createConnection: mock((config: any) => ({ mockConnection: true, config })),
	withTransaction: mock((conn: any, cb: any) => cb(conn)),
	getRawClient: mock((_conn: any) => ({ rawClient: true }))
};

class TestDatabase extends AbstractDatabase<any, any> {
	protected driver = mockDriver;
}

describe('AbstractDatabase', () => {
	afterEach(() => {
		jest.restoreAllMocks();
		jest.clearAllMocks();
	});

	describe('getConnection', () => {
		it('should retrieve an existing connection', () => {
			const mockConnection = { mockConnection: true };
			const getSpy = spyOn(Service, 'get').mockReturnValue(mockConnection);

			const result = new TestDatabase().getConnection('test');

			expect(getSpy).toHaveBeenCalledWith('db.connection.test');
			expect(result).toBe(mockConnection);
		});

		it('should throw ServiceNotFoundError if the connection does not exist', () => {
			spyOn(Service, 'get').mockReturnValue(null);

			expect(() => new TestDatabase().getConnection('test')).toThrow(ServiceNotFoundError);
		});

		it('should return the transaction handle for the default connection', () => {
			const tx = { tx: true };
			const originalDescriptor = Object.getOwnPropertyDescriptor(Application, 'context');
			Object.defineProperty(Application, 'context', {
				get: () => ({ getStore: () => new Map([['db:tx', tx]]) }),
				configurable: true
			});

			try {
				expect(new TestDatabase().getConnection()).toBe(tx);
			} finally {
				if (originalDescriptor) Object.defineProperty(Application, 'context', originalDescriptor);
			}
		});
	});

	describe('transaction', () => {
		const main = { name: 'main' };
		const other = { name: 'other' };
		const services: Record<string, unknown> = {
			'db.connection.main': main,
			'db.connection.default': main,
			'db.connection.other': other
		};

		const useServices = () =>
			spyOn(Service, 'get').mockImplementation(((name: string) => services[name] ?? null) as never);

		it('exposes the transaction to every name of its connection', async () => {
			useServices();
			const tx = { tx: 'main' };
			mockDriver.withTransaction.mockImplementationOnce((_conn: any, cb: any) => cb(tx));
			const db = new TestDatabase();

			const seen = await db.transaction(async () => ({
				main: db.getConnection('main'),
				default: db.getConnection(),
				other: db.getConnection('other')
			}));

			expect(mockDriver.withTransaction).toHaveBeenCalledWith(main, expect.any(Function));
			expect(seen).toEqual({ main: tx, default: tx, other });
		});

		it('opens the transaction on a named connection', async () => {
			useServices();
			const tx = { tx: 'other' };
			mockDriver.withTransaction.mockImplementationOnce((_conn: any, cb: any) => cb(tx));
			const db = new TestDatabase();

			const seen = await db.transaction(
				async (handle) => [handle, db.getConnection('other'), db.getConnection('main')],
				'other'
			);

			expect(mockDriver.withTransaction).toHaveBeenCalledWith(other, expect.any(Function));
			expect(seen).toEqual([tx, tx, main]);
			expect(db.getConnection('other')).toBe(other);
		});

		it('keeps the current context entries and does not change the current store', async () => {
			useServices();
			const tx = { tx: 'main' };
			mockDriver.withTransaction.mockImplementationOnce((_conn: any, cb: any) => cb(tx));
			const db = new TestDatabase();
			const store = new Map<any, unknown>([['tenant', 'acme']]);

			const tenant = await Application.context.run(store, () =>
				db.transaction(async () => Application.context.getStore()?.get('tenant'))
			);

			expect(tenant).toBe('acme');
			expect([...store.keys()]).toEqual(['tenant']);
		});

		it('joins the transaction already open on the connection', async () => {
			useServices();
			const tx = { tx: 'main' };
			mockDriver.withTransaction.mockImplementationOnce((_conn: any, cb: any) => cb(tx));
			const db = new TestDatabase();

			const inner = await db.transaction(() => db.transaction(async (handle) => handle, 'main'));

			expect(inner).toBe(tx);
			expect(mockDriver.withTransaction).toHaveBeenCalledTimes(1);
		});

		it('reports whether a transaction is active on a connection', async () => {
			useServices();
			mockDriver.withTransaction.mockImplementationOnce((_conn: any, cb: any) => cb({}));
			const db = new TestDatabase();

			expect(db.inTransaction()).toBe(false);
			const inside = await db.transaction(async () => [
				db.inTransaction('main'),
				db.inTransaction('other')
			]);

			expect(inside).toEqual([true, false]);
		});

		it('returns the connection itself from getBaseConnection inside a transaction', async () => {
			useServices();
			mockDriver.withTransaction.mockImplementationOnce((_conn: any, cb: any) => cb({}));
			const db = new TestDatabase();

			expect(await db.transaction(async () => db.getBaseConnection())).toBe(main);
		});
	});

	describe('connectionExists', () => {
		it('should delegate to Service.exists', () => {
			const existsSpy = spyOn(Service, 'exists')
				.mockReturnValueOnce(true)
				.mockReturnValueOnce(false);
			const db = new TestDatabase();

			expect(db.connectionExists('test')).toBe(true);
			expect(db.connectionExists('test')).toBe(false);
			expect(existsSpy).toHaveBeenCalledWith('db.connection.test');
		});
	});

	describe('getDefaultConnection', () => {
		it('should retrieve the default connection', () => {
			const originalDescriptor = Object.getOwnPropertyDescriptor(Application, 'context');
			Object.defineProperty(Application, 'context', {
				get: () => ({ getStore: () => null }),
				configurable: true
			});

			try {
				const mockConnection = { mockConnection: true };
				const getSpy = spyOn(Service, 'get').mockReturnValue(mockConnection);

				expect(new TestDatabase().getDefaultConnection()).toBe(mockConnection);
				expect(getSpy).toHaveBeenCalledWith('db.connection.default');
			} finally {
				if (originalDescriptor) Object.defineProperty(Application, 'context', originalDescriptor);
			}
		});
	});

	describe('getRawClient', () => {
		it('should return the raw client from the driver', () => {
			const mockConnection = { mockConnection: true };
			spyOn(Service, 'get').mockReturnValue(mockConnection);

			const result = new TestDatabase().getRawClient('test');

			expect(mockDriver.getRawClient).toHaveBeenCalledWith(mockConnection);
			expect(result).toEqual({ rawClient: true });
		});
	});
});
