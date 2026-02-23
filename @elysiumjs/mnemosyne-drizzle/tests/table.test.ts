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

import { describe, expect, it } from 'bun:test';
import * as d from 'drizzle-orm/pg-core';

import { getTableBuilders, pgTable } from '../src/table';

describe('pgTable', () => {
	describe('table creation', () => {
		it('should create a table with the same signature as drizzle pgTable', () => {
			const cols = {
				id: d.uuid().primaryKey().defaultRandom(),
				name: d.varchar().notNull()
			};

			const table = pgTable('users', cols);

			expect(table).toBeDefined();
			expect(table).toHaveProperty('id');
			expect(table).toHaveProperty('name');
		});

		it('should support extraConfig parameter', () => {
			const cols = {
				id: d.uuid().primaryKey().defaultRandom()
			};

			const table = pgTable('items', cols, (t) => ({
				unique: t.unique().on(t.id)
			}));

			expect(table).toBeDefined();
		});
	});

	describe('column builder registry', () => {
		it('should register column builders for created tables', () => {
			const cols = {
				id: d.uuid().primaryKey().defaultRandom(),
				email: d.varchar().notNull()
			};

			const table = pgTable('registered', cols);
			const builders = getTableBuilders(table);

			expect(builders).toBeDefined();
			expect(builders).toHaveProperty('id');
			expect(builders).toHaveProperty('email');
		});

		it('should return undefined for tables not created with enhanced pgTable', () => {
			const rawTable = d.pgTable('raw', {
				id: d.uuid().primaryKey()
			});

			const builders = getTableBuilders(rawTable);
			expect(builders).toBeUndefined();
		});
	});
});
