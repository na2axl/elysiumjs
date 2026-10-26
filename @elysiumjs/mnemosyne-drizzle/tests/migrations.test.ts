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

import { describe, expect, it } from 'bun:test';

import { getMigrationName, planMigrations, stripPublicSchema } from '../src/migrations';

const dir = '/app/src/database/migrations';

// Records applied after every migration in these tests was generated.
const applied = (...names: string[]) =>
	names.map((name) => ({ name, appliedAt: new Date('2027-01-01T00:00:00Z') }));

describe('getMigrationName', () => {
	it('should use the file name of a flat migration', () => {
		expect(getMigrationName(`${dir}/0000_users.sql`)).toBe('0000_users.sql');
	});

	it('should use the folder name of a Drizzle Kit 1.0 migration', () => {
		expect(getMigrationName(`${dir}/20260101120000_users/migration.sql`)).toBe(
			'20260101120000_users'
		);
	});
});

describe('planMigrations', () => {
	it('should run every migration on an empty database, in order', () => {
		const files = [
			`${dir}/20260102000000_posts/migration.sql`,
			`${dir}/20260101000000_users/migration.sql`
		];

		expect(planMigrations(files, applied())).toEqual({
			pending: [
				`${dir}/20260101000000_users/migration.sql`,
				`${dir}/20260102000000_posts/migration.sql`
			],
			renames: []
		});
	});

	it('should skip migrations already applied under their current name', () => {
		const files = [`${dir}/0000_users.sql`, `${dir}/20260101000000_posts/migration.sql`];

		expect(planMigrations(files, applied('0000_users.sql', '20260101000000_posts'))).toEqual({
			pending: [],
			renames: []
		});
	});

	it('should recognise flat migrations that drizzle-kit up moved into folders', () => {
		const files = [
			`${dir}/20250301101500_users/migration.sql`,
			`${dir}/20250302090000_posts/migration.sql`,
			`${dir}/20260101000000_comments/migration.sql`
		];

		expect(planMigrations(files, applied('0000_users.sql', '0001_posts.sql'))).toEqual({
			pending: [`${dir}/20260101000000_comments/migration.sql`],
			renames: [
				{ from: '0000_users.sql', to: '20250301101500_users' },
				{ from: '0001_posts.sql', to: '20250302090000_posts' }
			]
		});
	});

	it('should match timestamp-prefixed flat migrations whose prefix differs from the folder', () => {
		const files = [`${dir}/20250301101501_add_users_table/migration.sql`];

		expect(planMigrations(files, applied('20250301101459_add_users_table.sql'))).toEqual({
			pending: [],
			renames: [
				{ from: '20250301101459_add_users_table.sql', to: '20250301101501_add_users_table' }
			]
		});
	});

	it('should pair repeated names in order', () => {
		const files = [
			`${dir}/20250301000000_update/migration.sql`,
			`${dir}/20250302000000_update/migration.sql`,
			`${dir}/20250303000000_update/migration.sql`
		];

		expect(planMigrations(files, applied('0000_update.sql', '0001_update.sql'))).toEqual({
			pending: [`${dir}/20250303000000_update/migration.sql`],
			renames: [
				{ from: '0000_update.sql', to: '20250301000000_update' },
				{ from: '0001_update.sql', to: '20250302000000_update' }
			]
		});
	});

	it('should not move a record whose flat file is still there', () => {
		const files = [`${dir}/0000_users.sql`, `${dir}/20260101000000_users/migration.sql`];

		expect(planMigrations(files, applied('0000_users.sql'))).toEqual({
			pending: [`${dir}/20260101000000_users/migration.sql`],
			renames: []
		});
	});

	it('should run a new migration that reuses the name of a deleted one', () => {
		const files = [`${dir}/20260101000000_update/migration.sql`];
		const records = [{ name: '0003_update.sql', appliedAt: new Date('2025-06-01T00:00:00Z') }];

		expect(planMigrations(files, records)).toEqual({
			pending: [`${dir}/20260101000000_update/migration.sql`],
			renames: []
		});
	});
});

describe('stripPublicSchema', () => {
	it('removes the public qualifier from identifiers', () => {
		expect(
			stripPublicSchema(
				'CREATE TABLE "public"."users" ("id" integer);\nALTER TABLE "public"."posts" ADD CONSTRAINT "fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id");'
			)
		).toBe(
			'CREATE TABLE "users" ("id" integer);\nALTER TABLE "posts" ADD CONSTRAINT "fk" FOREIGN KEY ("user_id") REFERENCES "users"("id");'
		);
	});

	it('keeps string literals, including escaped quotes', () => {
		const sql = `INSERT INTO "public"."notes" VALUES ('see "public"."users"', 'it''s "public".x', E'\\' "public".y');`;

		expect(stripPublicSchema(sql)).toBe(
			`INSERT INTO "notes" VALUES ('see "public"."users"', 'it''s "public".x', E'\\' "public".y');`
		);
	});

	it('keeps dollar-quoted bodies such as DO blocks and functions', () => {
		const sql = [
			'DO $$ BEGIN',
			' ALTER TABLE "public"."users" ADD COLUMN "x" int;',
			'EXCEPTION WHEN duplicate_column THEN null;',
			'END $$;',
			'CREATE FUNCTION f() RETURNS int AS $fn$ SELECT count(*) FROM "public"."users" $fn$ LANGUAGE sql;',
			'CREATE INDEX "i" ON "public"."users" ("x");'
		].join('\n');

		expect(stripPublicSchema(sql)).toBe(sql.replace('ON "public"."users"', 'ON "users"'));
	});

	it('keeps comments', () => {
		const sql = '-- moved from "public"."old"\n/* "public"."a" */ SELECT * FROM "public"."a";';

		expect(stripPublicSchema(sql)).toBe(
			'-- moved from "public"."old"\n/* "public"."a" */ SELECT * FROM "a";'
		);
	});

	it('keeps identifiers that only contain public', () => {
		const sql = 'SELECT "public_id" FROM "not_public"."t", "x"."public";';

		expect(stripPublicSchema(sql)).toBe(sql);
	});
});
