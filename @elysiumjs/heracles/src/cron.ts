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

import { ElysiumError } from '@elysiumjs/core';

/**
 * Raised when a cron expression cannot be parsed.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class InvalidCronError extends ElysiumError {
	constructor(
		public readonly expression: string,
		reason: string
	) {
		super(`Invalid cron expression "${expression}": ${reason}.`);
	}
}

type Field = { min: number; max: number; names?: string[] };

const FIELDS: Field[] = [
	{ min: 0, max: 59 },
	{ min: 0, max: 23 },
	{ min: 1, max: 31 },
	{
		min: 1,
		max: 12,
		names: ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
	},
	{ min: 0, max: 7, names: ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] }
];

const ALIASES: Record<string, string> = {
	'@yearly': '0 0 1 1 *',
	'@annually': '0 0 1 1 *',
	'@monthly': '0 0 1 * *',
	'@weekly': '0 0 * * 0',
	'@daily': '0 0 * * *',
	'@midnight': '0 0 * * *',
	'@hourly': '0 * * * *'
};

/**
 * A parsed cron expression: the values each field allows, and whether the day of the month and
 * the day of the week were restricted (when both are, a day matching either one matches).
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type CronSchedule = {
	readonly expression: string;
	readonly minutes: ReadonlySet<number>;
	readonly hours: ReadonlySet<number>;
	readonly days: ReadonlySet<number>;
	readonly months: ReadonlySet<number>;
	readonly weekdays: ReadonlySet<number>;
	readonly anyDay: boolean;
	readonly anyWeekday: boolean;
};

const value = (expression: string, field: Field, raw: string): number => {
	const index = field.names?.indexOf(raw.toLowerCase()) ?? -1;
	const number = index >= 0 ? index + (field.min === 1 ? 1 : 0) : Number(raw);
	if (!Number.isInteger(number) || number < field.min || number > field.max) {
		throw new InvalidCronError(expression, `"${raw}" is out of ${field.min}-${field.max}`);
	}
	return number;
};

const parseField = (expression: string, field: Field, source: string): Set<number> => {
	const values = new Set<number>();
	for (const part of source.split(',')) {
		const [range, stepText] = part.split('/') as [string, string | undefined];
		const step = stepText === undefined ? 1 : Number(stepText);
		if (!Number.isInteger(step) || step < 1) {
			throw new InvalidCronError(expression, `"${part}" has an invalid step`);
		}
		let from: number;
		let to: number;
		if (range === '*') {
			from = field.min;
			to = field.max;
		} else if (range.includes('-')) {
			const [a, b] = range.split('-') as [string, string];
			from = value(expression, field, a);
			to = value(expression, field, b);
			if (from > to) throw new InvalidCronError(expression, `"${range}" is a reversed range`);
		} else {
			from = value(expression, field, range);
			to = stepText === undefined ? from : field.max;
		}
		for (let n = from; n <= to; n += step) values.add(n);
	}
	return values;
};

export namespace Cron {
	/**
	 * Parses a 5-field cron expression (minute, hour, day of month, month, day of week), with
	 * lists, ranges, steps, month and day names, and the `@hourly`, `@daily`, `@weekly`,
	 * `@monthly` and `@yearly` aliases. Times are UTC, as in Cloudflare cron triggers.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param expression The expression.
	 * @throws {InvalidCronError} When the expression is not valid.
	 */
	export const parse = (expression: string): CronSchedule => {
		const source = ALIASES[expression.trim().toLowerCase()] ?? expression.trim();
		const parts = source.split(/\s+/);
		if (parts.length !== 5) throw new InvalidCronError(expression, 'expected 5 fields');
		const [minutes, hours, days, months, weekdays] = parts.map((part, i) =>
			parseField(expression, FIELDS[i]!, part)
		) as [Set<number>, Set<number>, Set<number>, Set<number>, Set<number>];
		if (weekdays.delete(7)) weekdays.add(0);
		return {
			expression,
			minutes,
			hours,
			days,
			months,
			weekdays,
			anyDay: parts[2] === '*',
			anyWeekday: parts[4] === '*'
		};
	};

	/**
	 * Whether a minute matches a schedule.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param schedule The parsed schedule.
	 * @param date The minute, read in UTC.
	 */
	export const matches = (schedule: CronSchedule, date: Date): boolean => {
		if (!schedule.minutes.has(date.getUTCMinutes())) return false;
		if (!schedule.hours.has(date.getUTCHours())) return false;
		if (!schedule.months.has(date.getUTCMonth() + 1)) return false;
		const day = schedule.days.has(date.getUTCDate());
		const weekday = schedule.weekdays.has(date.getUTCDay());
		if (schedule.anyDay && schedule.anyWeekday) return true;
		if (schedule.anyDay) return weekday;
		if (schedule.anyWeekday) return day;
		return day || weekday;
	};

	/**
	 * The first minute after `from` that matches a schedule.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param schedule The parsed schedule.
	 * @param from The time to start after.
	 * @throws {InvalidCronError} When no minute matches within 5 years (such as `0 0 31 2 *`).
	 */
	export const next = (schedule: CronSchedule, from: Date): Date => {
		const date = new Date(from.getTime());
		date.setUTCSeconds(0, 0);
		date.setUTCMinutes(date.getUTCMinutes() + 1);
		const limit = from.getTime() + 5 * 366 * 24 * 60 * 60 * 1000;
		while (date.getTime() <= limit) {
			if (!schedule.months.has(date.getUTCMonth() + 1)) {
				date.setUTCMonth(date.getUTCMonth() + 1, 1);
				date.setUTCHours(0, 0);
				continue;
			}
			if (!Cron.matches({ ...schedule, minutes: ALL_MINUTES, hours: ALL_HOURS }, date)) {
				date.setUTCDate(date.getUTCDate() + 1);
				date.setUTCHours(0, 0);
				continue;
			}
			if (!schedule.hours.has(date.getUTCHours())) {
				date.setUTCHours(date.getUTCHours() + 1, 0);
				continue;
			}
			if (!schedule.minutes.has(date.getUTCMinutes())) {
				date.setUTCMinutes(date.getUTCMinutes() + 1);
				continue;
			}
			return date;
		}
		throw new InvalidCronError(schedule.expression, 'it matches no time in the next 5 years');
	};
}

const ALL_MINUTES = new Set(Array.from({ length: 60 }, (_, i) => i));
const ALL_HOURS = new Set(Array.from({ length: 24 }, (_, i) => i));
