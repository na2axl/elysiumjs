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

import { afterEach, beforeEach, describe, expect, it, jest, mock, spyOn } from 'bun:test';

import { Application, Service } from '@elysiumjs/core';

import { AbstractDatabase } from '../src/database';

const mockDriver = {
	createConnection: mock((config: any) => ({ mockConnection: true, config })),
	withTransaction: mock((conn: any, cb: any) => cb(conn)),
	getRawClient: mock((conn: any) => ({ rawClient: true })),
};

class TestDatabase extends AbstractDatabase<any, any> {
	protected driver = mockDriver;
}

describe('AbstractDatabase', () => {
	// Mock console.error and process.exit to prevent actual console output and process exit
	const originalConsoleError = console.error;
	const originalProcessExit = process.exit;

	beforeEach(() => {
		console.error = mock();
		process.exit = mock() as any;
	});

	afterEach(() => {
		console.error = originalConsoleError;
		process.exit = originalProcessExit;
		jest.clearAllMocks();
	});

	describe('registerConnection', () => {
		it('should register a new connection', () => {
			const db = new TestDatabase();

			// Mock Service.exists to return false (connection doesn't exist)
			const existsSpy = spyOn(Service, 'exists').mockReturnValueOnce(false);
			const instanceSpy = spyOn(Service, 'instance');

			// Call the function
			const result = db.registerConnection('test', { connection: 'sqlite:test.db' });

			// Check if Service.exists was called with the correct connection name
			expect(existsSpy).toHaveBeenCalledWith('db.connection.test');

			// Check if the driver's createConnection was called with the config
			expect(mockDriver.createConnection).toHaveBeenCalledWith({ connection: 'sqlite:test.db' });

			// Check if Service.instance was called with the correct parameters
			expect(instanceSpy).toHaveBeenCalledWith('db.connection.test', {
				mockConnection: true,
				config: { connection: 'sqlite:test.db' }
			});
		});

		it('should throw an error if the connection already exists', () => {
			const db = new TestDatabase();

			// Mock Service.exists to return true (connection exists)
			const existsSpy = spyOn(Service, 'exists').mockReturnValueOnce(true);

			// Call the function
			db.registerConnection('test', { connection: 'sqlite:test.db' });

			// Check if console.error and process.exit were called
			expect(console.error).toHaveBeenCalledWith(
				expect.stringContaining('A connection with the name test has already been registered')
			);
			expect(process.exit).toHaveBeenCalledWith(1);
		});
	});

	describe('getConnection', () => {
		it('should retrieve an existing connection', () => {
			const db = new TestDatabase();

			// Mock Service.exists to return true (connection exists)
			const existsSpy = spyOn(Service, 'exists').mockReturnValueOnce(true);

			// Mock Service.get to return a mock connection
			const mockConnection = { mockConnection: true };
			const getSpy = spyOn(Service, 'get').mockReturnValue(mockConnection);

			// Call the function
			const result = db.getConnection('test');

			// Check if Service.exists was called with the correct connection name
			expect(existsSpy).toHaveBeenCalledWith('db.connection.test');

			// Check if Service.get was called with the correct connection name
			expect(getSpy).toHaveBeenCalledWith('db.connection.test');

			// Check if the result is correct
			expect(result as any).toEqual(mockConnection);
		});

		it('should throw an error if the connection does not exist', () => {
			const db = new TestDatabase();

			// Mock Service.exists to return false (connection doesn't exist)
			const existsSpy = spyOn(Service, 'exists').mockReturnValueOnce(false);

			// Call the function
			db.getConnection('test');

			// Check if console.error and process.exit were called
			expect(console.error).toHaveBeenCalledWith(
				expect.stringContaining('No connection with name test found')
			);
			expect(process.exit).toHaveBeenCalledWith(1);
		});
	});

	describe('connectionExists', () => {
		it('should return true if the connection exists', () => {
			const db = new TestDatabase();

			// Mock Service.exists to return true
			const existsSpy = spyOn(Service, 'exists').mockReturnValueOnce(true);

			// Call the function
			const result = db.connectionExists('test');

			// Check if Service.exists was called with the correct connection name
			expect(existsSpy).toHaveBeenCalledWith('db.connection.test');

			// Check if the result is correct
			expect(result).toBe(true);
		});

		it('should return false if the connection does not exist', () => {
			const db = new TestDatabase();

			// Mock Service.exists to return false
			const existsSpy = spyOn(Service, 'exists').mockReturnValueOnce(false);

			// Call the function
			const result = db.connectionExists('test');

			// Check if Service.exists was called with the correct connection name
			expect(existsSpy).toHaveBeenCalledWith('db.connection.test');

			// Check if the result is correct
			expect(result).toBe(false);
		});
	});

	describe('getDefaultConnection', () => {
		it('should retrieve the default connection', () => {
			const db = new TestDatabase();

			// Save original descriptor and mock Application.context
			const originalDescriptor = Object.getOwnPropertyDescriptor(Application, 'context');
			Object.defineProperty(Application, 'context', {
				get: () => ({ getStore: () => null }),
				configurable: true,
			});

			// Mock Service.exists to return true and Service.get to return a mock connection
			const mockConnection = { mockConnection: true };
			spyOn(Service, 'exists').mockReturnValueOnce(true);
			spyOn(Service, 'get').mockReturnValue(mockConnection);

			// Call the function
			const result = db.getDefaultConnection();

			// Check if the result is correct
			expect(result as any).toEqual(mockConnection);

			// Restore original descriptor
			if (originalDescriptor) {
				Object.defineProperty(Application, 'context', originalDescriptor);
			}
		});
	});

	describe('setDefaultConnection', () => {
		it('should set the default connection', () => {
			const db = new TestDatabase();

			// Save original descriptor and mock Application.context
			const originalDescriptor = Object.getOwnPropertyDescriptor(Application, 'context');
			Object.defineProperty(Application, 'context', {
				get: () => ({ getStore: () => null }),
				configurable: true,
			});

			const instanceSpy = spyOn(Service, 'instance');
			const removeSpy = spyOn(Service, 'remove');

			// Mock getConnection to return a mock connection
			const mockConnection = { mockConnection: true };
			spyOn(Service, 'exists').mockReturnValue(true);
			spyOn(Service, 'get').mockReturnValue(mockConnection);

			// Call the function
			const result = db.setDefaultConnection('test');

			// Check if Service.remove was called with the correct connection name
			expect(removeSpy).toHaveBeenCalledWith('db.connection.default');

			// Check if Service.instance was called with the correct parameters
			expect(instanceSpy).toHaveBeenCalledWith('db.connection.default', mockConnection);

			// Check if the result is correct
			expect(result as any).toEqual(mockConnection);

			// Restore original descriptor
			if (originalDescriptor) {
				Object.defineProperty(Application, 'context', originalDescriptor);
			}
		});
	});

	describe('getRawClient', () => {
		it('should return the raw client from the driver', () => {
			const db = new TestDatabase();

			// Mock getConnection to return a mock connection
			const mockConnection = { mockConnection: true };
			spyOn(Service, 'exists').mockReturnValue(true);
			spyOn(Service, 'get').mockReturnValue(mockConnection);

			// Call the function
			const result = db.getRawClient('test');

			// Check if the driver's getRawClient was called with the connection
			expect(mockDriver.getRawClient).toHaveBeenCalledWith(mockConnection);

			// Check if the result is correct
			expect(result).toEqual({ rawClient: true });
		});
	});
});
