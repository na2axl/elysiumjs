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

import type { RedisConnection } from '@elysiumjs/redis';

import { Redis } from '@elysiumjs/redis';
import { afterEach, describe, expect, it, setSystemTime, spyOn } from 'bun:test';

import { Cron, InvalidCronError } from '../src/cron';
import { Job } from '../src/job';
import { JobRegistry } from '../src/registry';
import { Schedule, Scheduler, schedulesOf } from '../src/schedule';

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
@Schedule('*/5 * * * *', { args: ['daily'] })
@Schedule('0 0 * * *')
class ReportJob extends Job {
	protected async execute(): Promise<void> {}
}

describe('Scheduler', () => {
	afterEach(() => {
		JobRegistry.clear();
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

	it('dispatches a job at its time, once per tick across schedulers holding the lock', async () => {
		register();
		const dispatched: unknown[][] = [];
		const dispatch = spyOn(Scheduler, 'dispatch').mockImplementation(async (job) => {
			dispatched.push(job.schedule.args);
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
		const a = new Scheduler({ redis: 'default' });
		const b = new Scheduler({ redis: 'default' });
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
});
