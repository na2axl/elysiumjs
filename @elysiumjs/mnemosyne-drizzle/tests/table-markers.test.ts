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
import { sql } from 'drizzle-orm';
import { pgSchema, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { applyTableMarkers, DrizzleTable, getTableMarker } from '../src';

const kernel = pgSchema('kernel');

const MIGRATION = `CREATE SCHEMA "kernel";
--> statement-breakpoint
CREATE TABLE "kernel"."audit" (
	"id" uuid DEFAULT gen_random_uuid(),
	"recorded_at" timestamp DEFAULT now() NOT NULL,
	"note" text DEFAULT 'a;(b)',
	CONSTRAINT "audit_id_recorded_at_pk" PRIMARY KEY("id","recorded_at")
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid,
	"occurred_at" timestamp
);
--> statement-breakpoint
CREATE INDEX "events_id_idx" ON "events" USING btree ("id");`;

const auditColumns = {
	id: uuid('id').defaultRandom(),
	recordedAt: timestamp('recorded_at').notNull().defaultNow(),
	note: text('note').default('a;(b)')
};

describe('DrizzleTable.define', () => {
	it('returns the table it marks, with the markers merged', () => {
		const table = kernel.table('audit', auditColumns);
		const after = () => 'SELECT 1';

		const marked = DrizzleTable.define(
			DrizzleTable.partitioned({ range: 'recorded_at' }),
			DrizzleTable.afterCreate(after)
		)(table);

		expect(marked).toBe(table);
		expect(getTableMarker(table)).toEqual({ range: ['recorded_at'], afterCreate: [after] });
		expect(Object.keys(table)).not.toContain('range');
	});

	it('leaves unmarked tables without markers', () => {
		expect(getTableMarker(pgTable('plain', { id: uuid('id') }))).toBeUndefined();
	});
});

describe('applyTableMarkers', () => {
	it('partitions the table its migration creates and runs the SQL after it', () => {
		const audit = DrizzleTable.define(
			DrizzleTable.partitioned({ range: (t) => t.recordedAt }),
			DrizzleTable.afterCreate(
				({ qualified }) =>
					`CREATE TRIGGER audit_append_only BEFORE UPDATE OR DELETE ON ${qualified} FOR EACH ROW EXECUTE FUNCTION forbid_change()`
			),
			DrizzleTable.afterCreate(
				({ schema, name }) =>
					sql`CREATE TABLE ${sql.identifier(schema!)}.${sql.identifier(`${name}_default`)} PARTITION OF ${sql.identifier(schema!)}.${sql.identifier(name)} DEFAULT;`
			)
		)(kernel.table('audit', auditColumns, (t) => [primaryKey({ columns: [t.id, t.recordedAt] })]));

		const output = applyTableMarkers(MIGRATION, [audit]);

		expect(output).toContain(`	CONSTRAINT "audit_id_recorded_at_pk" PRIMARY KEY("id","recorded_at")
) PARTITION BY RANGE ("recorded_at");
--> statement-breakpoint
CREATE TRIGGER audit_append_only BEFORE UPDATE OR DELETE ON "kernel"."audit" FOR EACH ROW EXECUTE FUNCTION forbid_change();
--> statement-breakpoint
CREATE TABLE "kernel"."audit_default" PARTITION OF "kernel"."audit" DEFAULT;
--> statement-breakpoint
CREATE TABLE "events" (`);
		expect(output).toContain(`"note" text DEFAULT 'a;(b)',`);
	});

	it('handles public tables and partition keys of several columns', () => {
		const events = DrizzleTable.define(
			DrizzleTable.partitioned({ range: ['occurred_at', 'id'] }),
			DrizzleTable.afterCreate(
				({ schema, qualified }) => `COMMENT ON TABLE ${qualified} IS '${schema ?? 'public'}'`
			)
		)(pgTable('events', { id: uuid('id'), occurredAt: timestamp('occurred_at') }));

		const output = applyTableMarkers(MIGRATION, [events]);

		expect(output).toContain(`	"occurred_at" timestamp
) PARTITION BY RANGE ("occurred_at", "id");
--> statement-breakpoint
COMMENT ON TABLE "events" IS 'public';
--> statement-breakpoint
CREATE INDEX`);
	});

	it('leaves migrations that do not create a marked table as they are', () => {
		const outbox = DrizzleTable.define(DrizzleTable.partitioned({ range: 'created_at' }))(
			kernel.table('outbox', { id: uuid('id'), createdAt: timestamp('created_at') })
		);
		const unmarked = kernel.table('audit', auditColumns);

		expect(applyTableMarkers(MIGRATION, [outbox, unmarked])).toBe(MIGRATION);
	});
});
