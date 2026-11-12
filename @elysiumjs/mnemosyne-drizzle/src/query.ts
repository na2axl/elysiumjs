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

import type { ParsedFilter, ParsedQuery } from '@elysiumjs/mnemosyne';
import type { SQL } from 'drizzle-orm';
import type { PgColumn, PgTableWithColumns } from 'drizzle-orm/pg-core';

import {
	and,
	asc,
	desc,
	eq,
	gt,
	gte,
	ilike,
	inArray,
	isNotNull,
	isNull,
	lt,
	lte,
	ne,
	or
} from 'drizzle-orm';

/** Escapes the `LIKE` wildcards of a value matched literally. */
const escapeLike = (value: string): string => value.replace(/[\\%_]/g, (char) => `\\${char}`);

const columnOf = (table: PgTableWithColumns<any>, column: string): PgColumn => {
	const found = table[column] as PgColumn | undefined;
	if (!found) throw new Error(`The table has no column "${column}" for the query.`);
	return found;
};

/**
 * Compiles one filter of a parsed query to a Drizzle condition.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @param table The table queried.
 * @param filter The filter.
 */
export const compileFilter = (table: PgTableWithColumns<any>, filter: ParsedFilter): SQL => {
	const column = columnOf(table, filter.column);
	const value = filter.value as any;
	switch (filter.operator) {
		case 'eq':
			return eq(column, value);
		case 'ne':
			return ne(column, value);
		case 'gt':
			return gt(column, value);
		case 'gte':
			return gte(column, value);
		case 'lt':
			return lt(column, value);
		case 'lte':
			return lte(column, value);
		case 'in':
			return inArray(column, value as unknown[]);
		case 'contains':
			return ilike(column, `%${escapeLike(String(value))}%`);
		case 'startsWith':
			return ilike(column, `${escapeLike(String(value))}%`);
		case 'isNull':
			return value ? isNull(column) : isNotNull(column);
	}
};

/**
 * Compiles the condition that keeps the rows after the cursor, in sort order: a keyset condition
 * over every sort key, the row key last.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @param table The table queried.
 * @param query The parsed query, with `after` set.
 */
export const compileAfter = (
	table: PgTableWithColumns<any>,
	query: ParsedQuery
): SQL | undefined => {
	if (!query.after) return undefined;
	const branches = query.sort.map((key, index) => {
		const equal = query.sort
			.slice(0, index)
			.map((previous, i) => eq(columnOf(table, previous.column), query.after![i]));
		const column = columnOf(table, key.column);
		const value = query.after![index];
		return and(...equal, key.direction === 'asc' ? gt(column, value) : lt(column, value))!;
	});
	return or(...branches);
};

/**
 * Compiles a parsed query: the `where` condition (filters and cursor) and the `order by`.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @param table The table queried.
 * @param query The parsed query.
 */
export const compileQuery = (table: PgTableWithColumns<any>, query: ParsedQuery) => ({
	where: and(
		...query.filters.map((filter) => compileFilter(table, filter)),
		compileAfter(table, query)
	),
	orderBy: query.sort.map(({ column, direction }) =>
		direction === 'asc' ? asc(columnOf(table, column)) : desc(columnOf(table, column))
	)
});
