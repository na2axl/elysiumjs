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

import { InvalidModuleConfigError } from './errors';

const DEFAULT = 'default';

/**
 * Checks the `default` and `connections` keys of a connection module's config.
 * @author Axel Nana <axel.nana@workbud.com>
 * @param module The module name, for error messages.
 * @param config The resolved config.
 * @returns Whether a separate alias entry is needed for the default connection.
 * @throws {InvalidModuleConfigError} When the default is unknown or collides with a `default` connection.
 */
export function needsDefaultAlias(
	module: string,
	config: { default: string; connections: Record<string, unknown> }
): boolean {
	if (!Object.hasOwn(config.connections, config.default)) {
		throw new InvalidModuleConfigError(
			module,
			'default',
			`"${config.default}" is not one of the declared connections`
		);
	}
	if (config.default === DEFAULT) return false;
	if (Object.hasOwn(config.connections, DEFAULT)) {
		throw new InvalidModuleConfigError(
			module,
			'connections',
			`a connection named "default" conflicts with the default alias to "${config.default}"`
		);
	}
	return true;
}

/**
 * Runs every task even if some fail, then rethrows: the single error, or an `AggregateError`.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export async function runAll(tasks: (() => unknown)[]): Promise<void> {
	const results = await Promise.allSettled(tasks.map(async (task) => task()));
	const errors = results.flatMap((r) => (r.status === 'rejected' ? [r.reason] : []));
	if (errors.length === 1) throw errors[0];
	if (errors.length > 1) throw new AggregateError(errors, 'Several connections failed to close.');
}
