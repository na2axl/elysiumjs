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

import { describe, expect, it, mock, spyOn } from 'bun:test';

import { AbstractDatabase } from '../src/database';
import { AbstractRepository } from '../src/repository';

// Create a mock driver
const mockDriver = {
	createConnection: mock((config: any) => ({ mockConnection: true, config })),
	withTransaction: mock((conn: any, cb: any) => cb(conn)),
	getRawClient: mock((conn: any) => ({ rawClient: true })),
};

// Create a concrete database class for testing
class TestDatabase extends AbstractDatabase<any, any> {
	protected driver = mockDriver;
}

// Create a mock model
const MockModel = {
	$inferSelect: undefined as unknown,
	$inferInsert: undefined as unknown,
	$inferUpdate: undefined as unknown,
	table: { _tableName: 'test_table' },
	tableName: 'test_table',
	columns: { id: 'uuid', name: 'text' },
	insertSchema: {},
	updateSchema: {},
	selectSchema: {},
	supportTenancy: false,
} as any;

describe('AbstractRepository', () => {
	describe('Repository creation', () => {
		it('should create a repository class with the correct model', () => {
			const db = new TestDatabase();
			const TestRepository = AbstractRepository(MockModel, db);

			expect(TestRepository.Model).toBe(MockModel);
		});

		it('should set the default connection name', () => {
			const db = new TestDatabase();
			const TestRepository = AbstractRepository(MockModel, db);

			expect(TestRepository.connection).toBe('default');
		});
	});

	describe('Database connection', () => {
		it('should get the database connection via the db getter', () => {
			const db = new TestDatabase();
			const mockConnection = { mockConnection: true };
			const getConnectionSpy = spyOn(db, 'getConnection').mockReturnValue(mockConnection);

			const TestRepository = AbstractRepository(MockModel, db);

			// Create a concrete subclass since AbstractRepository returns an abstract class
			class ConcreteRepository extends TestRepository {
				public async all() { return []; }
				public async paginate() { return { page: 1, data: [], total: 0 }; }
				public async find() { return null; }
				public async findBy() { return null; }
				public async insert(data: any) { return data; }
				public async update(id: any, data: any) { return data; }
				public async updateAll(data: any) { return [data]; }
				public async delete(id: any) { return {}; }
				public async deleteAll() { return []; }
				public async exists(id: any) { return false; }
			}

			const repo = new ConcreteRepository();
			const connection = repo.db;

			expect(getConnectionSpy).toHaveBeenCalledWith('default');
			expect(connection).toBe(mockConnection);
		});

		it('should use a custom connection if specified', () => {
			const db = new TestDatabase();
			const mockConnection = { mockConnection: true };
			const getConnectionSpy = spyOn(db, 'getConnection').mockReturnValue(mockConnection);

			const TestRepository = AbstractRepository(MockModel, db);

			// Create a concrete subclass with a custom connection
			class CustomRepository extends TestRepository {
				public static readonly connection = 'custom';
				public async all() { return []; }
				public async paginate() { return { page: 1, data: [], total: 0 }; }
				public async find() { return null; }
				public async findBy() { return null; }
				public async insert(data: any) { return data; }
				public async update(id: any, data: any) { return data; }
				public async updateAll(data: any) { return [data]; }
				public async delete(id: any) { return {}; }
				public async deleteAll() { return []; }
				public async exists(id: any) { return false; }
			}

			const repo = new CustomRepository();
			const connection = repo.db;

			expect(getConnectionSpy).toHaveBeenCalledWith('custom');
			expect(connection).toBe(mockConnection);
		});
	});

	describe('Abstract methods', () => {
		it('should be subclassable with all CRUD methods implemented', () => {
			const db = new TestDatabase();
			const TestRepository = AbstractRepository(MockModel, db);

			// Create a concrete subclass implementing all abstract methods
			class ConcreteRepository extends TestRepository {
				public async all() { return []; }
				public async paginate() { return { page: 1, data: [], total: 0 }; }
				public async find() { return null; }
				public async findBy() { return null; }
				public async insert(data: any) { return data; }
				public async update(id: any, data: any) { return data; }
				public async updateAll(data: any) { return [data]; }
				public async delete(id: any) { return {}; }
				public async deleteAll() { return []; }
				public async exists(id: any) { return false; }
			}

			const repo = new ConcreteRepository();
			expect(repo).toBeInstanceOf(ConcreteRepository);
			expect(repo).toBeInstanceOf(TestRepository);
		});

		it('should have all required CRUD methods on the concrete subclass', () => {
			const db = new TestDatabase();
			const TestRepository = AbstractRepository(MockModel, db);

			class ConcreteRepository extends TestRepository {
				public async all() { return []; }
				public async paginate() { return { page: 1, data: [], total: 0 }; }
				public async find() { return null; }
				public async findBy() { return null; }
				public async insert(data: any) { return data; }
				public async update(id: any, data: any) { return data; }
				public async updateAll(data: any) { return [data]; }
				public async delete(id: any) { return {}; }
				public async deleteAll() { return []; }
				public async exists(id: any) { return false; }
			}

			const repo = new ConcreteRepository();

			expect(typeof repo.all).toBe('function');
			expect(typeof repo.paginate).toBe('function');
			expect(typeof repo.find).toBe('function');
			expect(typeof repo.findBy).toBe('function');
			expect(typeof repo.insert).toBe('function');
			expect(typeof repo.update).toBe('function');
			expect(typeof repo.updateAll).toBe('function');
			expect(typeof repo.delete).toBe('function');
			expect(typeof repo.deleteAll).toBe('function');
			expect(typeof repo.exists).toBe('function');
		});
	});
});
