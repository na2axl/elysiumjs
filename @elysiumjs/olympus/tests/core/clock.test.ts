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

import { afterEach, describe, expect, it } from 'bun:test';

import { Clock, ClockAdjustmentRefusedError, SystemClock } from '../../src/clock';
import { Runtime } from '../../src/runtime';
import { testRuntime } from './test-runtime';

describe('Clock', () => {
	afterEach(() => {
		Clock.reset();
		Clock.use(SystemClock);
	});

	it('follows the system clock by default', () => {
		const before = Date.now();
		const now = Clock.now().getTime();
		expect(now).toBeGreaterThanOrEqual(before);
		expect(now).toBeLessThanOrEqual(Date.now());
		expect(Clock.isAdjusted()).toBe(false);
	});

	it('freezes at a time, given as a date, a number or a string', () => {
		Clock.freeze('2026-01-01T00:00:00Z');
		expect(Clock.now().toISOString()).toBe('2026-01-01T00:00:00.000Z');
		Clock.freeze(new Date('2026-02-01T00:00:00Z'));
		expect(Clock.epochMs()).toBe(Date.parse('2026-02-01T00:00:00Z'));
		Clock.freeze(0);
		expect(Clock.epochMs()).toBe(0);
		expect(Clock.isAdjusted()).toBe(true);
	});

	it('moves a frozen clock by a duration', () => {
		Clock.freeze('2026-01-01T00:00:00Z');
		Clock.travel(14 * 24 * 3600 * 1000);
		expect(Clock.now().toISOString()).toBe('2026-01-15T00:00:00.000Z');
		Clock.travel(-24 * 3600 * 1000);
		expect(Clock.now().toISOString()).toBe('2026-01-14T00:00:00.000Z');
	});

	it('moves a running clock and keeps it running', () => {
		const day = 24 * 3600 * 1000;
		Clock.travel(day);
		const ahead = Clock.epochMs() - Date.now();
		expect(ahead).toBeGreaterThan(day - 1000);
		expect(ahead).toBeLessThanOrEqual(day);
	});

	it('takes its time from another source', () => {
		Clock.use({ now: () => new Date('2030-05-05T10:00:00Z') });
		expect(Clock.now().toISOString()).toBe('2030-05-05T10:00:00.000Z');
		Clock.travel(1000);
		expect(Clock.now().toISOString()).toBe('2030-05-05T10:00:01.000Z');
	});

	it('runs again at the real time once reset', () => {
		Clock.freeze(0);
		Clock.reset();
		expect(Math.abs(Clock.epochMs() - Date.now())).toBeLessThan(1000);
		expect(Clock.isAdjusted()).toBe(false);
	});

	it('refuses to be frozen or moved outside development and test', () => {
		const original = Runtime.find();
		try {
			Runtime.use({ ...testRuntime, env: () => ({ NODE_ENV: 'production' }) });
			expect(() => Clock.freeze(0)).toThrow(ClockAdjustmentRefusedError);
			expect(() => Clock.travel(1000)).toThrow(ClockAdjustmentRefusedError);
			expect(Clock.isAdjusted()).toBe(false);
		} finally {
			if (original) Runtime.use(original);
		}
	});
});
