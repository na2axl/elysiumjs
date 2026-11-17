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

// Runs against a real PostgreSQL when DATABASE_URL is set, such as
// DATABASE_URL=postgres://postgres:postgres@localhost:5432/elysium_test bun test.

import type { WorkflowStep } from '@elysiumjs/olympus/odysseus';

import { Application, Clock, Module, Service, t } from '@elysiumjs/olympus';
import {
	EngineDriver,
	Odysseus,
	OdysseusModule,
	Workflow,
	WorkflowEvent,
	Workflows,
	WorkflowStore
} from '@elysiumjs/olympus/odysseus';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { sql } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';

import { workflowStoreContract } from '../../olympus/tests/odysseus/store-contract';
import { DrizzleWorkflowStore, workflowTables } from '../src';
import { bunSql } from '../src/drivers/bun-sql';

const url = process.env.DATABASE_URL;

const Paid = WorkflowEvent.define('paid', t.Object({ amount: t.Integer() }));
let shipped = 0;

@Workflow.register({ name: 'pg.order' })
class Order extends Workflow<{ sku: string }, { sku: string; amount: number }> {
	public async run(params: { sku: string }, step: WorkflowStep) {
		const reserved = await step.do('reserve', () => ({ sku: params.sku }));
		const paid = await step.waitFor('paid', Paid, { timeout: '1 day' });
		if (!('amount' in paid)) throw new Error('not paid');
		await step.sleep('cool down', '1 hour');
		await step.do('ship', () => void (shipped += 1));
		return { sku: reserved.sku, amount: paid.amount };
	}
}

@Module.register({ workflows: [Order] })
class OrdersModule extends Module {}
const tables = workflowTables('test_odysseus');

describe('workflowTables', () => {
	it('builds the tables, their keys and indexes', () => {
		const instances = getTableConfig(tables.instances);
		expect(instances.schema).toBe('test_odysseus');
		expect(instances.columns.map((c) => c.name)).toEqual([
			'workflow',
			'id',
			'params',
			'status',
			'output',
			'error',
			'wake_at',
			'lease_owner',
			'lease_until',
			'seq',
			'created_at',
			'updated_at'
		]);
		expect(instances.primaryKeys[0]!.columns.map((c) => c.name)).toEqual(['workflow', 'id']);
		expect(instances.indexes.map((i) => i.config.name)).toEqual([
			'workflow_instances_due_idx',
			'workflow_instances_finished_idx'
		]);
		expect(getTableConfig(workflowTables().steps).primaryKeys[0]!.columns.length).toBe(3);
		expect(getTableConfig(workflowTables().events).name).toBe('workflow_events');
	});

	it('registers the drizzle driver of the workflow store', () => {
		expect(WorkflowStore.has('drizzle')).toBe(true);
		expect(WorkflowStore.for('drizzle', { tables })).toBeInstanceOf(DrizzleWorkflowStore);
	});
});

describe.skipIf(!url)('DrizzleWorkflowStore on PostgreSQL', () => {
	const driver = bunSql({ url });
	const db = driver.connect({});

	beforeAll(async () => {
		Service.instance('db.connection.default', db);
		await db.execute(sql`drop schema if exists test_odysseus cascade`);
		await db.execute(sql`create schema test_odysseus`);
		await db.execute(sql`
			create table test_odysseus.workflow_instances (
				workflow text not null, id text not null, params jsonb, status text not null,
				output jsonb, error jsonb, wake_at timestamptz, lease_owner text,
				lease_until timestamptz, seq integer not null default 0,
				created_at timestamptz not null, updated_at timestamptz not null,
				primary key (workflow, id))`);
		await db.execute(sql`
			create table test_odysseus.workflow_steps (
				workflow text not null, id text not null, key text not null, step jsonb not null,
				primary key (workflow, id, key))`);
		await db.execute(sql`
			create table test_odysseus.workflow_events (
				workflow text not null, id text not null, seq integer not null, type text not null,
				payload jsonb, at timestamptz not null, primary key (workflow, id, seq))`);
	});

	afterAll(async () => {
		await db.execute(sql`drop schema if exists test_odysseus cascade`);
		Service.remove('db.connection.default');
	});

	workflowStoreContract({ describe, it, expect }, 'drizzle', async () => {
		await db.execute(
			sql`truncate test_odysseus.workflow_instances, test_odysseus.workflow_steps, test_odysseus.workflow_events`
		);
		return new DrizzleWorkflowStore({ tables });
	});

	it('runs a workflow on the engine driver over Postgres', async () => {
		await db.execute(
			sql`truncate test_odysseus.workflow_instances, test_odysseus.workflow_steps, test_odysseus.workflow_events`
		);
		Clock.freeze('2026-11-01T00:00:00Z');
		const engine = Workflows.for('engine', {
			store: new DrizzleWorkflowStore({ tables }),
			work: false
		}) as EngineDriver;
		const app = await Application.testing({
			modules: [OdysseusModule.with({ driver: engine }), OrdersModule],
			boot: 'eager'
		});
		Service.instance('db.connection.default', db);
		try {
			await Odysseus.start(Order, { sku: 'mug' }, { id: 'o-1' });
			await engine.drain();
			expect(await Odysseus.status(Order, 'o-1')).toMatchObject({ status: 'waiting' });
			await Odysseus.signal(Order, 'o-1', Paid, { amount: 1500 });
			await engine.drain();
			Clock.travel(3_600_000);
			await engine.drain();
			expect(await Odysseus.status(Order, 'o-1')).toMatchObject({
				status: 'completed',
				output: { sku: 'mug', amount: 1500 }
			});
			expect(shipped).toBe(1);
		} finally {
			await app.shutdown();
			Clock.reset();
			Service.instance('db.connection.default', db);
		}
	});

	it('lets one of many claims of an instance win', async () => {
		await db.execute(sql`truncate test_odysseus.workflow_instances`);
		const store = new DrizzleWorkflowStore({ tables });
		const now = Date.parse('2026-11-01T00:00:00Z');
		await store.create({
			workflow: 'race',
			id: 'a',
			params: {},
			status: 'queued',
			wakeAt: now,
			createdAt: now,
			updatedAt: now
		});
		const claims = await Promise.all(
			Array.from({ length: 8 }, (_, i) =>
				store.claim('race', 'a', { owner: `w${i}`, until: now + 1000 }, now)
			)
		);
		expect(claims.filter(Boolean).length).toBe(1);
	});

	it('purges in batches until none is left', async () => {
		await db.execute(
			sql`truncate test_odysseus.workflow_instances, test_odysseus.workflow_steps, test_odysseus.workflow_events`
		);
		const store = new DrizzleWorkflowStore({ tables, purgeBatch: 2 });
		const now = Date.parse('2026-11-01T00:00:00Z');
		for (const [id, at] of [
			['a', 1],
			['b', 1],
			['c', 1],
			['d', 1],
			['e', 1],
			['late', 100]
		] as const) {
			await store.create({
				workflow: 'w',
				id,
				params: null,
				status: 'queued',
				wakeAt: now,
				createdAt: now,
				updatedAt: now
			});
			await store.claim('w', id, { owner: 'o', until: now + 1000 }, now);
			await store.saveStep('w', id, 'o', 's', { kind: 'done', value: 1 });
			await store.settle('w', id, 'o', { status: 'completed', wakeAt: null, seenSeq: 0 }, now + at);
		}
		expect(await store.purge(now + 50)).toBe(5);
		expect(await store.get('w', 'late')).not.toBeNull();
		const [{ count }] = (await db.execute(
			sql`select count(*)::int as count from test_odysseus.workflow_steps`
		)) as unknown as [{ count: number }];
		expect(count).toBe(1);
	});
});
