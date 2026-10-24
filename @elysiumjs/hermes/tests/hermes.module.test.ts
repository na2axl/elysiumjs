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

import { Application, Service } from '@elysiumjs/core';
import { afterEach, describe, expect, it } from 'bun:test';

import { HermesLogger, HermesModule } from '../src';

describe('HermesModule', () => {
	let app: Awaited<ReturnType<typeof Application.testing>> | undefined;

	afterEach(async () => {
		await app?.shutdown();
		app = undefined;
	});

	it('registers nothing on import', () => {
		expect(Service.exists('logger')).toBe(false);
		expect(Service.exists(HermesLogger.name)).toBe(false);
	});

	it('provides one logger under both names, built from config', async () => {
		app = await Application.testing({ modules: [HermesModule.with({ level: 'debug' })] });
		const logger = await app.get<HermesLogger>('logger');
		expect(logger).toBeInstanceOf(HermesLogger);
		expect((logger as any).config.level).toBe('debug');
		expect(await app.get(HermesLogger)).toBe(logger);
	});

	it('falls back to the default level and format', async () => {
		app = await Application.testing({ modules: [HermesModule] });
		const logger = await app.get<HermesLogger>('logger');
		expect((logger as any).config).toMatchObject({ level: 'info', format: 'json' });
	});

	it('flushes the logger on shutdown', async () => {
		app = await Application.testing({ modules: [HermesModule.with({})] });
		const logger = await app.get<HermesLogger>('logger');
		let flushed = 0;
		logger.flush = () => {
			flushed++;
		};
		await app.shutdown();
		app = undefined;
		expect(flushed).toBe(1);
	});
});
