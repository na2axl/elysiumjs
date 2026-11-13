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

import type { AnyAbility } from '@casl/ability';
import type { SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';

import { rulesToAST } from '@casl/ability/extra';
import { ElysiumError } from '@elysiumjs/olympus';
import {
	and,
	eq,
	gt,
	gte,
	inArray,
	isNotNull,
	isNull,
	lt,
	lte,
	notInArray,
	or,
	sql
} from 'drizzle-orm';

/** One node of the condition tree CASL builds from the rules of an action. */
type ConditionNode = {
	readonly operator: string;
	readonly value: unknown;
	readonly field?: string;
};

/**
 * Thrown by `rulesToDrizzle()` when a rule condition names a field the table does not have, or
 * uses an operator that has no SQL form here.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class UntranslatableRuleError extends ElysiumError {
	constructor(detail: string) {
		super(`rulesToDrizzle: ${detail}`);
	}
}

const TRUE = sql`true`;
const FALSE = sql`false`;

const columnOf = (table: PgTable, field: string | undefined): PgColumn => {
	const column = field ? (table as unknown as Record<string, PgColumn | undefined>)[field] : null;
	if (!column) throw new UntranslatableRuleError(`the table has no column "${field}"`);
	return column;
};

const listOf = (value: unknown): unknown[] => (Array.isArray(value) ? value : [value]);

const children = (node: ConditionNode, table: PgTable): SQL[] =>
	listOf(node.value).map((child) => compile(child as ConditionNode, table));

const compile = (node: ConditionNode, table: PgTable): SQL => {
	switch (node.operator) {
		case 'and': {
			const parts = children(node, table);
			return parts.length === 0 ? TRUE : (and(...parts) ?? TRUE);
		}
		case 'or': {
			const parts = children(node, table);
			return parts.length === 0 ? FALSE : (or(...parts) ?? FALSE);
		}
		case 'not': {
			const parts = children(node, table);
			// A condition on a NULL column is unknown in SQL, but does not match in CASL: coalesce it,
			// so `cannot(..., { sensitive: true })` still allows the rows whose column is NULL.
			const inner = parts.length === 1 ? parts[0] : (and(...parts) ?? TRUE);
			return sql`not coalesce(${inner}, false)`;
		}
		case 'eq':
			return node.value === null
				? isNull(columnOf(table, node.field))
				: eq(columnOf(table, node.field), node.value);
		case 'ne':
			// NULL matches, as it does in CASL.
			return node.value === null
				? isNotNull(columnOf(table, node.field))
				: sql`${columnOf(table, node.field)} is distinct from ${node.value}`;
		case 'in': {
			// A null in the list matches NULL, as it does in CASL; SQL's `in` never matches it.
			const column = columnOf(table, node.field);
			const all = listOf(node.value);
			const values = all.filter((value) => value !== null);
			const parts = [
				...(values.length > 0 ? [inArray(column, values)] : []),
				...(values.length < all.length ? [isNull(column)] : [])
			];
			return parts.length === 0 ? FALSE : (or(...parts) ?? FALSE);
		}
		case 'nin': {
			// NULL matches unless the list holds a null, as it does in CASL.
			const column = columnOf(table, node.field);
			const all = listOf(node.value);
			const values = all.filter((value) => value !== null);
			const listsNull = values.length < all.length;
			if (values.length === 0) return listsNull ? isNotNull(column) : TRUE;
			return listsNull
				? (and(isNotNull(column), notInArray(column, values)) ?? TRUE)
				: (or(notInArray(column, values), isNull(column)) ?? TRUE);
		}
		case 'lt':
			return lt(columnOf(table, node.field), node.value);
		case 'lte':
			return lte(columnOf(table, node.field), node.value);
		case 'gt':
			return gt(columnOf(table, node.field), node.value);
		case 'gte':
			return gte(columnOf(table, node.field), node.value);
		case 'exists':
			return node.value
				? isNotNull(columnOf(table, node.field))
				: isNull(columnOf(table, node.field));
		default:
			throw new UntranslatableRuleError(`the operator "${node.operator}" is not supported`);
	}
};

/**
 * The SQL condition that keeps the rows of `table` the ability allows `action` on, from its rules
 * about `subject`: a list query then answers only what the same rules let the caller act on. CASL
 * flattens the rules first, so a `cannot` bounds every `can` before it. Rule fields are the
 * properties of the table's columns. No ability, or no rule that allows the action: `false`; a
 * rule without conditions: `true`. `$eq`, `$ne`, `$in` and `$nin` treat NULL as CASL does;
 * `$lt`, `$lte`, `$gt`, `$gte` and `$exists` follow SQL, where NULL compares to nothing.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @param ability The ability, or `undefined` for an actor without one.
 * @param action The action, such as `update`.
 * @param subject The subject the rules are about, such as `Post`.
 * @param table The table of that subject.
 * @throws {UntranslatableRuleError} When a condition names a field the table does not have, or
 * uses an operator other than `$eq`, `$ne`, `$in`, `$nin`, `$lt`, `$lte`, `$gt`, `$gte`,
 * `$exists`, `$and`, `$or` and `$not`.
 * @example
 * ```ts
 * const editable = await db
 * 	.select()
 * 	.from(posts)
 * 	.where(rulesToDrizzle(ability, 'update', 'Post', posts));
 * ```
 */
export const rulesToDrizzle = (
	ability: AnyAbility | undefined,
	action: string,
	subject: string,
	table: PgTable
): SQL => {
	if (!ability) return FALSE;
	const ast = rulesToAST(ability, action, subject) as ConditionNode | null;
	return ast ? compile(ast, table) : FALSE;
};
