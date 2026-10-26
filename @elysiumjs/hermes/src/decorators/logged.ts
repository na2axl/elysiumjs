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

import type { LoggerInterface } from '@elysiumjs/core';
import type { LogLevel } from '../types';

import { getLogger } from '@elysiumjs/core';

export interface LoggedOptions {
	level?: LogLevel;
	includeArgs?: boolean;
	includeResult?: boolean;
	includeTiming?: boolean;
}

/**
 * Decorator that logs method entry/exit with optional timing.
 *
 * Logger is resolved at CALL TIME (not decorator definition time)
 * to avoid capturing a stale logger reference.
 *
 * @author Axel Nana <axel.nana@workbud.com>
 */
export function Logged(options: LoggedOptions = {}): MethodDecorator {
	return function (
		target: object,
		propertyKey: string | symbol,
		descriptor: TypedPropertyDescriptor<any>
	) {
		const original = descriptor.value;
		const methodName = `${target.constructor.name}.${String(propertyKey)}`;

		descriptor.value = async function (...args: any[]) {
			const logger: LoggerInterface = (this as any).logger ?? getLogger();

			const startTime = Date.now();

			if (options.includeArgs) {
				logger.debug(`[${methodName}] Entry`, { args });
			}

			try {
				const result = await original.apply(this, args);

				if (options.includeResult || options.includeTiming) {
					const duration = Date.now() - startTime;
					logger[options.level ?? 'debug'](`[${methodName}] Exit`, {
						...(options.includeResult && { result }),
						...(options.includeTiming && { duration: `${duration}ms` })
					});
				}

				return result;
			} catch (error) {
				const duration = Date.now() - startTime;
				logger.error(`[${methodName}] Error`, {
					error,
					duration: `${duration}ms`
				});
				throw error;
			}
		};

		return descriptor;
	};
}
