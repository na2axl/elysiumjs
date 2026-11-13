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

import type { MongoAbility } from '@casl/ability';

import { AbilityBuilder, createMongoAbility } from '@casl/ability';
import { describe, expect, it } from 'bun:test';
import { boolean, PgDialect, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import { rulesToDrizzle, UntranslatableRuleError } from '../src/cerberus';

type TestAbility = MongoAbility<[string, string]>;

const posts = pgTable('posts', {
	id: text('id').primaryKey(),
	authorId: text('author_id').notNull(),
	status: text('status').notNull(),
	sensitive: boolean('sensitive'),
	linkedType: text('linked_type'),
	linkedId: text('linked_id'),
	publishedAt: timestamp('published_at')
});

const dialect = new PgDialect();

const abilityWith = (build: (builder: AbilityBuilder<TestAbility>) => void): TestAbility => {
	const builder = new AbilityBuilder<TestAbility>(createMongoAbility);
	build(builder);
	return builder.build();
};

const where = (ability: TestAbility, action = 'update') =>
	dialect.sqlToQuery(rulesToDrizzle(ability, action, 'Post', posts));

describe('rulesToDrizzle', () => {
	it('is false when no rule allows the action', () => {
		expect(where(abilityWith(() => {})).sql).toBe('false');
		expect(where(abilityWith(({ can }) => can('read', 'Post'))).sql).toBe('false');
	});

	it('is true for a rule without conditions', () => {
		expect(where(abilityWith(({ can }) => can('update', 'Post'))).sql).toBe('true');
	});

	it('ORs the can rules and bounds them with the cannot rules', () => {
		const ability = abilityWith(({ can, cannot }) => {
			can('update', 'Post', { authorId: { $in: ['a1', 'a2'] }, status: 'draft' });
			can('update', 'Post', { authorId: { $in: ['a2'] }, status: 'published' });
			cannot('update', 'Post', { sensitive: true });
		});
		const { sql, params } = where(ability);
		expect(sql).toBe(
			'(((("posts"."author_id" in ($1)) and ("posts"."status" = $2) and ' +
				'(not coalesce("posts"."sensitive" = $3, false)))) or ' +
				'((("posts"."author_id" in ($4, $5)) and ("posts"."status" = $6) and ' +
				'(not coalesce("posts"."sensitive" = $7, false)))))'
		);
		expect(params).toEqual(['a2', 'published', true, 'a1', 'a2', 'draft', true]);
	});

	it('keeps NULL rows for $ne and $nin, as CASL does', () => {
		const ability = abilityWith(({ can }) => {
			can('update', 'Post', { linkedType: { $ne: 'live' } });
			can('update', 'Post', { linkedId: { $nin: ['l1'] }, publishedAt: { $exists: true } });
		});
		expect(where(ability).sql).toBe(
			'(((((("posts"."linked_id" not in ($1)) or (("posts"."linked_id" is null)))) and ' +
				'(("posts"."published_at" is not null)))) or ("posts"."linked_type" is distinct from $2))'
		);
	});

	it('turns null comparisons and empty lists into their SQL forms', () => {
		const ability = abilityWith(({ can }) => {
			can('update', 'Post', { linkedId: null, authorId: { $in: [] } });
			can('update', 'Post', { linkedType: { $ne: null }, status: { $nin: [] } });
		});
		expect(where(ability).sql).toBe(
			'((((("posts"."linked_type" is not null)) and (true))) or ' +
				'(((("posts"."linked_id" is null)) and (false))))'
		);
	});

	it('matches NULL for a null in $in and $nin lists, as CASL does', () => {
		const ability = abilityWith(({ can }) => {
			can('update', 'Post', { linkedId: { $in: [null, 'l1'] } });
			can('update', 'Post', { linkedType: { $nin: [null, 'live'] } });
			can('update', 'Post', { status: { $nin: [null] } });
		});
		expect(where(ability).sql).toBe(
			'((("posts"."status" is not null)) or ' +
				'(((("posts"."linked_type" is not null)) and ("posts"."linked_type" not in ($1)))) or ' +
				'((("posts"."linked_id" in ($2)) or (("posts"."linked_id" is null)))))'
		);
	});

	it('is false without an ability', () => {
		expect(dialect.sqlToQuery(rulesToDrizzle(undefined, 'update', 'Post', posts)).sql).toBe(
			'false'
		);
	});

	it('refuses a field the table does not have', () => {
		const ability = abilityWith(({ can }) => can('update', 'Post', { nope: 1 }));
		expect(() => where(ability)).toThrow(UntranslatableRuleError);
	});

	it('refuses an operator it cannot translate', () => {
		const ability = abilityWith(({ can }) => can('update', 'Post', { status: { $regex: 'a' } }));
		expect(() => where(ability)).toThrow(UntranslatableRuleError);
	});
});
