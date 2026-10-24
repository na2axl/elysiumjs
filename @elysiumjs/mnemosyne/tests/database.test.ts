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
