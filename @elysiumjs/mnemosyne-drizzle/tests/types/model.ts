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

// Compile-time checks: run by `bun run typecheck`, not by `bun test`.
import { integer, pgTable, text } from 'drizzle-orm/pg-core';

import { DrizzleModel } from '../../src/model';
import { DrizzleRepository } from '../../src/repository';

const users = pgTable('users', { id: integer().primaryKey(), name: text().notNull() });
export class User extends DrizzleModel(users) {}
export class UserRepository extends DrizzleRepository(User) {}
type Row = typeof User.$inferSelect;
export const ok: Row = { id: 1, name: 'a' };
// @ts-expect-error id must be a number
export const bad: Row = { id: 'x', name: 'a' };
// @ts-expect-error name is required on insert
export const badInsert: typeof User.$inferInsert = { id: 1 };
export const found = async (r: UserRepository) => {
	const u = await r.find(1);
	// @ts-expect-error unknown column
	return u?.nope;
};
