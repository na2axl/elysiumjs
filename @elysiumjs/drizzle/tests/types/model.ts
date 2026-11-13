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

// Compile-time checks: run by `bun run typecheck`, not by `bun test`.
import type { JsonForm } from '@elysiumjs/olympus';
import type { ConnectionOf, ScopeOf } from '@elysiumjs/olympus/mnemosyne';
import type { SQL } from 'drizzle-orm';
import type { DrizzleConnection } from '../../src/database';

import { Pruner, Repository } from '@elysiumjs/olympus/mnemosyne';
import { eq } from 'drizzle-orm';
import { integer, pgTable, text } from 'drizzle-orm/pg-core';

import { DrizzleModel } from '../../src/model';

const users = pgTable('users', { id: integer().primaryKey(), name: text().notNull() });
export class User extends DrizzleModel(users) {}
export class UserRepository extends Repository(User) {}
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

// `this.db` is the Drizzle connection, and the scope of list(), count() and Pruner is SQL.
export class NamedUserRepository extends Repository(User) {
	public named(name: string) {
		const db: DrizzleConnection = this.db;
		return db.select().from(users).where(eq(users.name, name));
	}

	public countNamed(name: string) {
		return this.count(undefined, eq(users.name, name));
	}

	public wrongScope() {
		// @ts-expect-error the scope is an SQL condition
		return this.count(undefined, (row: unknown) => row !== null);
	}
}

export class PruneUsers extends Pruner(User) {
	protected get prunable(): SQL {
		return eq(users.name, 'gone');
	}
}

// @ts-expect-error a pruner names its rows with `prunable`
export class PruneNothing extends Pruner(User) {}

// A table typed `any` resolves to no backend, rather than to the first one declared.
export const anyScope: ScopeOf<any> = 'anything';
export const anyConnection: ConnectionOf<any> = 42;

// Observer methods are checked against the events of their repository.
@Repository.observer(UserRepository)
export class UserObserver {
	public creating({ data }: { data: typeof User.$inferInsert }) {
		if (!data.name) return new Error('a name is needed');
	}
}

// @ts-expect-error `created` receives `{ row }`, not `{ data }`
@Repository.observer(UserRepository)
export class WrongObserver {
	public created({ data }: { data: number }) {
		return data;
	}
}

// Repositories answer instances of the model: its columns, getters and methods.
const people = pgTable('people', { id: integer().primaryKey(), name: text().notNull() });
export class Person extends DrizzleModel(people) {
	public static override readonly hidden = ['name'] as const;
	public static override readonly appends = ['initial'] as const;

	public get initial(): string {
		return this.name.charAt(0);
	}
}
export class PersonRepository extends Repository(Person) {
	public async named(name: string): Promise<Person[]> {
		return this.hydrate(await this.db.select().from(people).where(eq(people.name, name)));
	}
}
export const person = async (r: PersonRepository): Promise<string | undefined> => {
	const p = await r.find(1);
	const instance: Person | null = p;
	return instance?.initial;
};
export const hydrated: Person = Person.hydrate({ id: 1, name: 'Ada' });
// @ts-expect-error hidden names columns
export class BadHidden extends DrizzleModel(people) {
	public static override readonly hidden = ['nope'] as const;
}

// Generated route types read the JSON form of what handlers answer.
type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const expectType = <T extends true>(): T => true as T;
type PersonRow = typeof Person.$inferSelect;
export const jsonForms = () => {
	expectType<Equal<JsonForm<Person>, PersonRow>>();
	expectType<Equal<JsonForm<Person[]>, PersonRow[]>>();
	expectType<Equal<JsonForm<{ data: Person[]; nextCursor: string | null }>['data'], PersonRow[]>>();
	expectType<Equal<JsonForm<Response>, Response>>();
	expectType<Equal<JsonForm<Date>, Date>>();
};
