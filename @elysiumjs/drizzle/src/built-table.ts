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

import type { AnyPgColumnBuilder, PgBuildColumns, PgTableWithColumns } from 'drizzle-orm/pg-core';

/**
 * The table `pgTable()` builds from a name, a schema and column builders, spelled with Drizzle's
 * own types. Functions that build tables return it, so that their declarations refer to Drizzle's
 * types instead of carrying a copy of them, and keep matching the Drizzle the app installs.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @template TName The name of the table.
 * @template TSchema The Postgres schema of the table, or `undefined` for the search path.
 * @template TColumns The column builders of the table.
 */
export type BuiltPgTable<
	TName extends string,
	TSchema extends string | undefined,
	TColumns extends Record<string, AnyPgColumnBuilder>
> = PgTableWithColumns<{
	name: TName;
	schema: TSchema;
	columns: PgBuildColumns<TName, TColumns>;
	dialect: 'pg';
	isAlias: false;
}>;
