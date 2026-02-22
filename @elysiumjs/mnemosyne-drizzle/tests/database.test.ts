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

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, jest, mock, spyOn } from 'bun:test';

import { Application, Service } from '@elysiumjs/core';

import { Database } from '../src/database';

// Mock drizzle function
mock.module('drizzle-orm/bun-sql', () => ({
	drizzle: mock(() => ({ mockDrizzleInstance: true }))
}));

describe('DrizzleDatabase', () => {
	// Mock console.error and process.exit to prevent actual console output and process exit
	const originalConsoleError = console.error;
	const originalProcessExit = process.exit;

	beforeAll(() => {
		// Mock Application.context so that getConnection('default') works
		const mockContext = {
			getStore: mock(() => new Map())
		};
		Object.defineProperty(Application, 'context', {
			get: () => mockContext,
			configurable: true
		});
	});

	beforeEach(() => {
		console.error = mock();
		process.exit = mock() as any;
	});

	afterEach(() => {
		console.error = originalConsoleError;
		process.exit = originalProcessExit;
		jest.clearAllMocks();
	});

	afterAll(() => {
		mock.restore();
	});

	describe('registerConnection', () => {
		it('should register a new connection', () => {
			// Mock Service.exists to return false (connection doesn't exist)
			const existsSpy = spyOn(Service, 'exists').mockReturnValueOnce(false);
			const instanceSpy = spyOn(Service, 'instance');

			// Call the function
			const result = Database.registerConnection('test', { connection: 'sqlite:test.db' });

			// Check if Service.exists was called with the correct connection name
			expect(existsSpy).toHaveBeenCalledWith('db.connection.test');

			// Check if Service.instance was called with the correct parameters
			expect(instanceSpy).toHaveBeenCalledWith('db.connection.test', {
				mockDrizzleInstance: true
			});

			// Check if the result is correct
			expect(result as any).toEqual({ mockDrizzleInstance: true });
		});

		it('should exit if the connection already exists', () => {
			// Mock Service.exists to return true (connection exists)
			spyOn(Service, 'exists').mockReturnValueOnce(true);

			// Call the function
			Database.registerConnection('test', { connection: 'sqlite:test.db' });

			// Check if console.error and process.exit were called
			expect(console.error).toHaveBeenCalledWith(
				expect.stringContaining('A connection with the name test has already been registered')
			);
			expect(process.exit).toHaveBeenCalledWith(1);
		});
	});

	describe('getConnection', () => {
		it('should retrieve an existing connection', () => {
			// Mock Service.exists to return true (connection exists)
			const existsSpy = spyOn(Service, 'exists').mockReturnValueOnce(true);

			// Mock Service.get to return a mock connection
			const mockConnection = { mockConnection: true };
			const getSpy = spyOn(Service, 'get').mockReturnValue(mockConnection);

			// Call the function
			const result = Database.getConnection('test');

			// Check if Service.exists was called with the correct connection name
			expect(existsSpy).toHaveBeenCalledWith('db.connection.test');

			// Check if Service.get was called with the correct connection name
			expect(getSpy).toHaveBeenCalledWith('db.connection.test');

			// Check if the result is correct
			expect(result as any).toEqual(mockConnection);
		});

		it('should exit if the connection does not exist', () => {
			// Mock Service.exists to return false (connection doesn't exist)
			spyOn(Service, 'exists').mockReturnValueOnce(false);

			// Call the function
			Database.getConnection('test');

			// Check if console.error and process.exit were called
			expect(console.error).toHaveBeenCalledWith(
				expect.stringContaining('No connection with name test found')
			);
			expect(process.exit).toHaveBeenCalledWith(1);
		});
	});

	describe('connectionExists', () => {
		it('should return true if the connection exists', () => {
			// Mock Service.exists to return true
			const existsSpy = spyOn(Service, 'exists').mockReturnValueOnce(true);

			// Call the function
			const result = Database.connectionExists('test');

			// Check if Service.exists was called with the correct connection name
			expect(existsSpy).toHaveBeenCalledWith('db.connection.test');

			// Check if the result is correct
			expect(result).toBe(true);
		});

		it('should return false if the connection does not exist', () => {
			// Mock Service.exists to return false
			const existsSpy = spyOn(Service, 'exists').mockReturnValueOnce(false);

			// Call the function
			const result = Database.connectionExists('test');

			// Check if Service.exists was called with the correct connection name
			expect(existsSpy).toHaveBeenCalledWith('db.connection.test');

			// Check if the result is correct
			expect(result).toBe(false);
		});
	});

	describe('getDefaultConnection', () => {
		it('should retrieve the default connection', () => {
			// Mock Service to return the mock connection
			const mockConnection = { mockConnection: true };
			spyOn(Service, 'exists').mockReturnValueOnce(true);
			spyOn(Service, 'get').mockReturnValue(mockConnection);

			// Call the function
			const result = Database.getDefaultConnection();

			// Check if the result is correct
			expect(result as any).toEqual(mockConnection);
		});
	});

	describe('setDefaultConnection', () => {
		it('should set the default connection', () => {
			const instanceSpy = spyOn(Service, 'instance');
			const removeSpy = spyOn(Service, 'remove');
			spyOn(Service, 'exists').mockReturnValueOnce(true);

			// Mock Service.get to return a mock connection
			const mockConnection = { mockConnection: true };
			spyOn(Service, 'get').mockReturnValue(mockConnection);

			// Call the function
			const result = Database.setDefaultConnection('test');

			// Check if Service.remove was called with the correct connection name
			expect(removeSpy).toHaveBeenCalledWith('db.connection.default');

			// Check if Service.instance was called with the correct parameters
			expect(instanceSpy).toHaveBeenCalledWith('db.connection.default', mockConnection);

			// Check if the result is correct
			expect(result as any).toEqual(mockConnection);
		});
	});
});
