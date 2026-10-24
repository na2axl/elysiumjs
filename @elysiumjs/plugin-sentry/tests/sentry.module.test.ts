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

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Application, Module } from '@elysiumjs/core';
import { describe, expect, it, mock } from 'bun:test';

const init = mock((_options: unknown) => {});
mock.module('@sentry/bun', () => ({
	init,
	bunServerIntegration: () => ({ name: 'bun' }),
	onUnhandledRejectionIntegration: () => ({ name: 'unhandled' }),
	onUncaughtExceptionIntegration: () => ({ name: 'uncaught' }),
	captureException: () => {}
}));
mock.module('@elysiajs/opentelemetry', () => ({
	opentelemetry: () => (app: unknown) => app
}));

const { SentryModule } = await import('../src');

const moduleWith = (config: Record<string, unknown>) => {
	@Module.register({ imports: [SentryModule.with(config as any)] })
	class AppModule extends Module {}
	return AppModule;
};

describe('SentryModule', () => {
	it('has no bare side-effect imports in its entry point', () => {
		const source = readFileSync(join(import.meta.dir, '../src/index.ts'), 'utf8');
		const bare = source.match(/^import\s+['"][^'"]+['"]/gm) ?? [];
		expect(bare.filter((line) => !line.includes('reflect-metadata'))).toEqual([]);
	});

	it('installs the sentry plugin built from the module config on serve', async () => {
		const app = await Application.testing({
			modules: [moduleWith({ dsn: 'https://k@example.com/1', environment: 'staging' })],
			boot: 'eager'
		});
		try {
			const use = mock((_plugin: unknown) => {});
			const instance = app.kernel.moduleInstance(app.kernel.graph.node(SentryModule)!);
			await instance.onServe({ use } as any);
			expect(init).toHaveBeenCalledWith(
				expect.objectContaining({ dsn: 'https://k@example.com/1', environment: 'staging' })
			);
			expect(use).toHaveBeenCalledTimes(1);
			const installed = (use.mock.calls[0] as unknown[])[0] as any;
			expect(installed.config.name).toBe('@elysiumjs/plugin-sentry');
		} finally {
			await app.shutdown();
		}
	});
});
