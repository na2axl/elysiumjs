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

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export type LogFormat = 'json' | 'pretty' | 'logfmt';

export interface TransportConfig {
	type: 'console' | 'file' | 'http';
	options?: Record<string, unknown>;
}

export interface HermesConfig {
	name?: string;
	level: LogLevel;
	format: LogFormat;
	transports?: TransportConfig[];
	/**
	 * Where log lines go: `pino`, or `console` for JSON lines through `console` with no
	 * dependency. Defaults to `console` on Cloudflare Workers and `pino` elsewhere.
	 */
	transport?: 'pino' | 'console';
}

export const DEFAULT_CONFIG: HermesConfig = {
	level: 'info',
	format: 'json'
};
