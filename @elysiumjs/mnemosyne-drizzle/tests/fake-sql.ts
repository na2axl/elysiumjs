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

import type { DrizzleConnection } from '../src/database';

import { drizzle } from 'drizzle-orm/bun-sql/postgres';

/** A statement received by the fake client. `client` is `root` or `tx` (inside `begin`). */
export type LoggedQuery = { client: 'root' | 'tx'; query: string; params: unknown[] };

/** Answers a query with the rows it returns. */
export type Responder = (query: string, params: unknown[]) => Record<string, unknown>[];

/**
 * Builds a stand-in for a `Bun.SQL` client, recording every statement it receives. Transactions
 * log `BEGIN`, `COMMIT` and `ROLLBACK`.
 * @param respond Answers each query. Returns no rows by default.
 */
export const fakeSql = (respond: Responder = () => []) => {
	const log: LoggedQuery[] = [];

	const make = (label: 'root' | 'tx'): any => {
		const client: any = () => {
			throw new Error('Tagged queries are not supported by the fake client');
		};
		client.unsafe = (query: string, params: unknown[] = []) => {
			log.push({ client: label, query, params });
			const rows = respond(query, params);
			return Object.assign(Promise.resolve(rows), {
				values: () => Promise.resolve(rows.map((row) => Object.values(row)))
			});
		};
		client.begin = async (callback: (tx: unknown) => Promise<unknown>) => {
			log.push({ client: label, query: 'BEGIN', params: [] });
			try {
				const result = await callback(make('tx'));
				log.push({ client: label, query: 'COMMIT', params: [] });
				return result;
			} catch (error) {
				log.push({ client: label, query: 'ROLLBACK', params: [] });
				throw error;
			}
		};
		client.savepoint = async (callback: (tx: unknown) => Promise<unknown>) => callback(make('tx'));
		client.options = {};
		client.close = async () => {};
		return client;
	};

	return { client: make('root'), log };
};

/**
 * Builds a real Drizzle connection over a {@link fakeSql} client.
 * @param respond Answers each query.
 */
export const fakeConnection = (respond?: Responder) => {
	const { client, log } = fakeSql(respond);
	return { connection: drizzle({ client }) as unknown as DrizzleConnection, client, log };
};
