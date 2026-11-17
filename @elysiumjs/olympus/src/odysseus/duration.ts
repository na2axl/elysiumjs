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

import { InvalidWorkflowStepError } from './errors.js';

/** A unit of {@link WorkflowDuration}, singular or plural. */
type DurationUnit =
	'millisecond' | 'second' | 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year';

/**
 * A duration: milliseconds, or a number and a unit such as `'30 seconds'`, `'1 day'` or
 * `'2 weeks'`. A month is 30 days and a year 365 days.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type WorkflowDuration = number | `${number} ${DurationUnit | `${DurationUnit}s`}`;

const UNIT_MS: Record<DurationUnit, number> = {
	millisecond: 1,
	second: 1_000,
	minute: 60_000,
	hour: 3_600_000,
	day: 86_400_000,
	week: 7 * 86_400_000,
	month: 30 * 86_400_000,
	year: 365 * 86_400_000
};

/**
 * The milliseconds of a duration.
 * @param duration The duration.
 * @throws {InvalidWorkflowStepError} When the duration cannot be read or is negative.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export const toMilliseconds = (duration: WorkflowDuration): number => {
	if (typeof duration === 'number') {
		if (!Number.isFinite(duration) || duration < 0) {
			throw new InvalidWorkflowStepError(`The duration ${duration} is not a positive number.`);
		}
		return duration;
	}
	const match = /^\s*(\d+(?:\.\d+)?)\s*([a-z]+?)s?\s*$/i.exec(duration);
	const unit = match?.[2]?.toLowerCase() as DurationUnit | undefined;
	if (!match || !unit || !(unit in UNIT_MS)) {
		throw new InvalidWorkflowStepError(
			`The duration "${duration}" cannot be read: write a number and a unit, such as "30 seconds".`
		);
	}
	return Math.round(Number(match[1]) * UNIT_MS[unit]);
};
