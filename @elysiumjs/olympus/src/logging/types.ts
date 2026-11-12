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

import type { LogLevel } from '../logger';
import type { PortDriverName } from '../port';

export type { LogLevel };

export type LogFormat = 'json' | 'pretty' | 'logfmt';

export interface TransportConfig {
	type: 'console' | 'file' | 'http';
	options?: Record<string, unknown>;
}

/**
 * The options of {@link LoggerModule}.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export interface LoggerConfig {
	name?: string;
	level: LogLevel;
	format: LogFormat;
	transports?: TransportConfig[];
	/**
	 * The `Logger` driver log lines go through: `console` for JSON lines through `console` with no
	 * dependency, or a driver a logging package registers, such as `pino` from `@elysiumjs/pino`.
	 * Defaults to `pino` when that package is loaded, except on Cloudflare Workers, and `console`
	 * otherwise.
	 */
	transport?: PortDriverName<'logger'>;
}

export const DEFAULT_CONFIG: LoggerConfig = {
	level: 'info',
	format: 'json'
};
