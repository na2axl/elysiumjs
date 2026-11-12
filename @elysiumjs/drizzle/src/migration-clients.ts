// Copyright (c) 2025-present Axel Nana <ax.lnana@outlook.com>. All rights reserved.
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

import type { SQL } from 'drizzle-orm';
import type { MigrationConnection, MigrationDatabase } from './migration';

import { PgDialect } from 'drizzle-orm/pg-core';

const dialect = new PgDialect();

/**
 * Turns a Drizzle `sql` template into its text, with `$1` placeholders, and its parameters.
 * @param query The statement.
 */
const toQuery = (query: SQL) => dialect.sqlToQuery(query);

/** A query of a tagged-template client, which runs once awaited. */
type UnsafeQuery = PromiseLike<unknown> & { simple?(): PromiseLike<unknown> };

/**
 * What `migration:run` uses of a tagged-template client (Bun SQL and postgres.js share it).
 */
export type TemplateClient = {
	unsafe(text: string, params?: unknown[]): UnsafeQuery;
	begin<T>(fn: (tx: TemplateClient) => Promise<T>): Promise<T>;
};

const templateDatabase = (client: TemplateClient): MigrationDatabase => ({
	execute: async <T>(query: SQL) => {
		const { sql, params } = toQuery(query);
		return [...((await client.unsafe(sql, params)) as Iterable<T>)];
	},
	script: async (text) => {
		// The simple protocol runs several statements in one query.
		const query = client.unsafe(text);
		await (query.simple ? query.simple() : query);
	}
});

/**
 * The migration connection of a tagged-template client: Bun SQL or postgres.js.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @param client The client.
 */
export const templateClientMigrations = (client: TemplateClient): MigrationConnection => ({
	...templateDatabase(client),
	transaction: (fn) => client.begin((tx) => fn(templateDatabase(tx)))
});

/** What `migration:run` uses of a node-postgres client. */
type PgQueryable = {
	query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
};

/** What `migration:run` uses of a node-postgres pool. */
export type PgPool = PgQueryable & {
	connect(): Promise<PgQueryable & { release(): void }>;
};

const pgDatabase = (client: PgQueryable): MigrationDatabase => ({
	execute: async <T>(query: SQL) => {
		const { sql, params } = toQuery(query);
		return (await client.query(sql, params)).rows as T[];
	},
	script: async (text) => {
		// Without values, node-postgres sends a simple query, which may hold several statements.
		await client.query(text);
	}
});

/**
 * The migration connection of a node-postgres pool.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @param pool The pool.
 */
export const nodePostgresMigrations = (pool: PgPool): MigrationConnection => ({
	...pgDatabase(pool),
	transaction: async (fn) => {
		const client = await pool.connect();
		try {
			await client.query('BEGIN');
			const result = await fn(pgDatabase(client));
			await client.query('COMMIT');
			return result;
		} catch (error) {
			await client.query('ROLLBACK');
			throw error;
		} finally {
			client.release();
		}
	}
});
