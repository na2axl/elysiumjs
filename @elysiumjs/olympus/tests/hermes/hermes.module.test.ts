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

import { afterEach, describe, expect, it } from 'bun:test';

import { HermesModule, JsonConsoleLogger } from '../../src/hermes';
import { Application, Logger, Service, UnknownPortDriverError } from '../../src/index';

describe('HermesModule', () => {
	let app: Awaited<ReturnType<typeof Application.testing>> | undefined;

	afterEach(async () => {
		await app?.shutdown();
		app = undefined;
	});

	it('registers nothing on import', () => {
		expect(Service.exists('logger')).toBe(false);
	});

	it('registers the console driver of the Logger port', () => {
		expect(Logger.for('console', { level: 'warn' })).toBeInstanceOf(JsonConsoleLogger);
	});

	it('uses the console driver when no logging package is loaded, built from config', async () => {
		app = await Application.testing({ modules: [HermesModule.with({ level: 'debug' })] });
		const logger = await app.get<JsonConsoleLogger>('logger');
		expect(logger).toBeInstanceOf(JsonConsoleLogger);
		expect(logger.level).toBe('debug');
	});

	it('falls back to the default level', async () => {
		app = await Application.testing({ modules: [HermesModule] });
		expect((await app.get<JsonConsoleLogger>('logger')).level).toBe('info');
	});

	it('builds the driver its transport names', async () => {
		@Logger.driver('hermes-test')
		class MemoryLogger extends JsonConsoleLogger {}
		app = await Application.testing({
			modules: [HermesModule.with({ transport: 'hermes-test' })]
		});
		expect(await app.get('logger')).toBeInstanceOf(MemoryLogger);
	});

	it('throws UnknownPortDriverError for a driver nobody registered', async () => {
		app = await Application.testing({ modules: [HermesModule.with({ transport: 'pino' })] });
		await expect(app.get('logger')).rejects.toBeInstanceOf(UnknownPortDriverError);
	});
});
