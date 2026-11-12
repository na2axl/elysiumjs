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

import { Environments } from './environments';
import { ElysiumError } from './errors';
import { currentEnvironment } from './utils';

/**
 * Where the time comes from. The system clock is the default; an app may plug another one, such
 * as a clock synchronised with a time server.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export interface ClockSource {
	/** The current time. */
	now(): Date;
}

/**
 * The clock of the machine.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export const SystemClock: ClockSource = { now: () => new Date() };

/**
 * Raised when the clock is frozen or moved outside `development` and `test`.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class ClockAdjustmentRefusedError extends ElysiumError {
	constructor(environment: string) {
		super(
			`The clock can only be frozen or moved in development and test, not in "${environment}".`
		);
	}
}

let source: ClockSource = SystemClock;
let frozenAt: number | undefined;
let offset = 0;

const assertAdjustable = (): void => {
	if (!Environments.includes(Environments.local))
		throw new ClockAdjustmentRefusedError(currentEnvironment());
};

const toTime = (at: Date | number | string): number =>
	at instanceof Date ? at.getTime() : typeof at === 'number' ? at : Date.parse(at);

/**
 * The time of the application. Code that decides on time (expiries, schedules, the instants it
 * records) reads it from here instead of `new Date()`, so that tests and development can freeze or
 * move it. Durations that only measure the machine, such as request timings, keep the real time.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @example
 * ```ts
 * const expiresAt = new Date(Clock.now().getTime() + ttl * 1000);
 *
 * // In a test:
 * Clock.freeze('2026-01-01T00:00:00Z');
 * Clock.travel(14 * 24 * 3600 * 1000);
 * Clock.reset();
 * ```
 */
export namespace Clock {
	/** The current time. */
	export const now = (): Date => new Date(epochMs());

	/** The current time, in milliseconds since the epoch. */
	export const epochMs = (): number =>
		frozenAt !== undefined ? frozenAt : source.now().getTime() + offset;

	/**
	 * Takes the time from another source. A frozen or moved clock stays so on top of it.
	 * @param clock The source, or `SystemClock` to go back to the machine's clock.
	 */
	export const use = (clock: ClockSource): void => {
		source = clock;
	};

	/**
	 * Stops the clock at a time, the current one by default, until it is moved or reset. Only in
	 * `development` and `test`.
	 * @param at The time to stop at.
	 * @throws {ClockAdjustmentRefusedError} In any other environment.
	 */
	export const freeze = (at: Date | number | string = epochMs()): void => {
		assertAdjustable();
		frozenAt = toTime(at);
	};

	/**
	 * Moves the clock forward (or back, with a negative duration), whether it is frozen or running.
	 * Only in `development` and `test`.
	 * @param ms The milliseconds to move by.
	 * @throws {ClockAdjustmentRefusedError} In any other environment.
	 */
	export const travel = (ms: number): void => {
		assertAdjustable();
		if (frozenAt !== undefined) frozenAt += ms;
		else offset += ms;
	};

	/** Whether the clock is frozen or moved. */
	export const isAdjusted = (): boolean => frozenAt !== undefined || offset !== 0;

	/** Lets the clock run again at the real time of its source. */
	export const reset = (): void => {
		frozenAt = undefined;
		offset = 0;
	};
}
