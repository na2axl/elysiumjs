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

import type { RedisConnection } from '@elysiumjs/redis';

import { Redis } from '@elysiumjs/redis';
import { afterEach, describe, expect, it, setSystemTime, spyOn } from 'bun:test';

import { wranglerTriggers } from '../src/commands/crons.command';
import { Cron, InvalidCronError } from '../src/cron';
import { Heracles } from '../src/heracles';
import { Job } from '../src/job';
import { JobRegistry } from '../src/registry';
import {
	clearSchedulers,
	DuplicateSchedulerError,
	Scheduler,
	ScheduleRunner,
	schedulesOf
} from '../src/schedule';

const next = (expression: string, from: string) =>
	Cron.next(Cron.parse(expression), new Date(from)).toISOString();

describe('Cron', () => {
	it('finds the next matching minute, in UTC', () => {
		expect(next('*/15 * * * *', '2026-11-06T03:07:30Z')).toBe('2026-11-06T03:15:00.000Z');
		expect(next('0 9 * * mon-fri', '2026-11-07T10:00:00Z')).toBe('2026-11-09T09:00:00.000Z');
		expect(next('@daily', '2026-11-06T03:00:00Z')).toBe('2026-11-07T00:00:00.000Z');
		expect(next('30 2 1 */3 *', '2026-11-06T03:00:00Z')).toBe('2027-01-01T02:30:00.000Z');
		expect(next('0 0 29 2 *', '2026-03-01T00:00:00Z')).toBe('2028-02-29T00:00:00.000Z');
		expect(next('0 0 * * 7', '2026-11-06T00:00:00Z')).toBe('2026-11-08T00:00:00.000Z');
	});

	it('matches a day of the month or of the week when both are set', () => {
		const schedule = Cron.parse('0 0 1 * fri');
		expect(Cron.matches(schedule, new Date('2026-11-06T00:00:00Z'))).toBe(true);
		expect(Cron.matches(schedule, new Date('2026-12-01T00:00:00Z'))).toBe(true);
		expect(Cron.matches(schedule, new Date('2026-11-07T00:00:00Z'))).toBe(false);
	});

	it('refuses invalid expressions', () => {
		expect(() => Cron.parse('* * * *')).toThrow(InvalidCronError);
		expect(() => Cron.parse('60 * * * *')).toThrow(InvalidCronError);
		expect(() => Cron.parse('*/0 * * * *')).toThrow(InvalidCronError);
		expect(() => next('0 0 31 2 *', '2026-01-01T00:00:00Z')).toThrow(InvalidCronError);
	});
});

@Job.register({ name: 'scheduled-report', queue: 'reports' })
@Scheduler.job('*/5 * * * *', { args: ['daily'] })
@Scheduler.job('0 0 * * *')
class ReportJob extends Job {
	protected async execute(): Promise<void> {}
}

describe('Scheduler', () => {
	afterEach(() => {
		JobRegistry.clear();
		clearSchedulers();
		setSystemTime();
	});

	const register = () =>
		JobRegistry.set([['scheduled-report', { jobClass: ReportJob as never, module: {} as never }]]);

	it('lists the schedules of the registry, and those of one expression', () => {
		register();
		expect(schedulesOf(ReportJob).map(({ cron }) => cron.expression)).toEqual([
			'0 0 * * *',
			'*/5 * * * *'
		]);
		expect(Scheduler.jobs()).toHaveLength(2);
		expect(Scheduler.jobsFor('*/5 * * * *').map(({ schedule }) => schedule.args)).toEqual([
			['daily']
		]);
	});

	it('gives the cron triggers the schedules need, and compares them with declared ones', () => {
		register();
		expect(Scheduler.crons()).toEqual(['*/5 * * * *', '0 0 * * *']);
		expect(Scheduler.compareCrons(['0 0 * * *', '*/5 * * * *'])).toEqual({
			missing: [],
			extra: []
		});
		expect(Scheduler.compareCrons(['0 0 * * *', '0 6 * * *', '0 6 * * *'])).toEqual({
			missing: ['*/5 * * * *'],
			extra: ['0 6 * * *']
		});
	});

	it('dispatches a job at its time, once per tick across schedulers holding the lock', async () => {
		register();
		const dispatched: unknown[][] = [];
		const dispatch = spyOn(Scheduler, 'dispatch').mockImplementation(async (job) => {
			dispatched.push(job.schedule.args);
			return 1;
		});
		const locks = new Set<string>();
		const connection = {
			async send(_command: string, [key]: string[]) {
				if (locks.has(key!)) return null;
				locks.add(key!);
				return 'OK';
			}
		} as unknown as RedisConnection;
		const getConnection = spyOn(Redis, 'getConnection').mockReturnValue(connection);

		setSystemTime(new Date('2026-11-06T03:04:59.990Z'));
		const a = new ScheduleRunner({ redis: 'default' });
		const b = new ScheduleRunner({ redis: 'default' });
		a.start();
		b.start();
		await new Promise((resolve) => setTimeout(resolve, 50));
		a.stop();
		b.stop();

		expect(dispatched).toEqual([['daily']]);
		expect([...locks]).toEqual([
			'heracles:schedule:scheduled-report:*/5 * * * *:2026-11-06T03:05:00.000Z'
		]);
		dispatch.mockRestore();
		getConnection.mockRestore();
	});

	it('fans a scheduler out: one job per case, with an id per scheduler, case and tick', async () => {
		@Job.register({ name: 'bill-invoice', queue: 'billing' })
		class BillInvoice extends Job {
			constructor(
				public readonly region: string,
				public readonly invoice: string
			) {
				super();
			}

			protected async execute(): Promise<void> {}
		}

		const ticks: string[] = [];
		@Scheduler.register({ cron: '0 6 * * *', job: BillInvoice, name: 'daily-billing' })
		class DailyBilling extends Scheduler<typeof BillInvoice> {
			public async fanOut(tick: Date) {
				ticks.push(tick.toISOString());
				return ['inv-1', 'inv-2'].map((id) => ({ key: id, args: ['eu', id] as [string, string] }));
			}
		}
		expect(DailyBilling).toBeDefined();

		const calls: unknown[][] = [];
		const dispatch = spyOn(Heracles, 'dispatch').mockImplementation(async (...args: unknown[]) => {
			calls.push(args);
			return { jobId: 'j', dispatchId: 'd' };
		});
		const [job] = Scheduler.jobsFor('0 6 * * *');
		expect(job!.name).toBe('daily-billing');
		expect(await Scheduler.dispatch(job!, new Date('2026-11-06T06:00:42.123Z'))).toBe(2);
		dispatch.mockRestore();

		expect(ticks).toEqual(['2026-11-06T06:00:00.000Z']);
		expect(calls).toEqual([
			[
				BillInvoice,
				['eu', 'inv-1'],
				{ dispatchId: 'schedule:daily-billing:inv-1@2026-11-06T06:00:00.000Z' }
			],
			[
				BillInvoice,
				['eu', 'inv-2'],
				{ dispatchId: 'schedule:daily-billing:inv-2@2026-11-06T06:00:00.000Z' }
			]
		]);
	});

	it('refuses two schedulers with one name', () => {
		class Noop extends Job {
			protected async execute(): Promise<void> {}
		}
		const declare = () => {
			@Scheduler.register({ cron: '@daily', job: Noop, name: 'twice' })
			class Twice extends Scheduler<typeof Noop> {
				public fanOut() {
					return [];
				}
			}
			return Twice;
		};
		declare();
		expect(declare).toThrow(DuplicateSchedulerError);
	});
});

describe('wranglerTriggers', () => {
	const config = {
		triggers: { crons: ['0 0 * * *'] },
		env: {
			staging: { vars: {} },
			production: { triggers: { crons: ['0 0 * * *', '*/5 * * * *'] } }
		}
	};

	it('reads the top level and each environment that sets its own triggers', () => {
		expect(wranglerTriggers(config)).toEqual([
			{ environment: null, crons: ['0 0 * * *'] },
			{ environment: 'production', crons: ['0 0 * * *', '*/5 * * * *'] }
		]);
	});

	it('reads one environment, which inherits the top level when it sets no triggers', () => {
		expect(wranglerTriggers(config, 'staging')).toEqual([
			{ environment: 'staging', crons: ['0 0 * * *'] }
		]);
		expect(wranglerTriggers(config, 'production')[0]?.crons).toHaveLength(2);
		expect(() => wranglerTriggers(config, 'preview')).toThrow('no environment "preview"');
	});
});
