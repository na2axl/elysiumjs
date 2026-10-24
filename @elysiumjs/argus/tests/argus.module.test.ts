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

import { Application, MissingModuleConfigError, Module } from '@elysiumjs/core';
import { Elysia } from 'elysia';
import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test';

import { ArgusModule, ArgusSDK, argusPlugin } from '../src';

const withConfig = (config: Record<string, unknown>) => {
	@Module.register({ imports: [ArgusModule.with(config as any)] })
	class AppModule extends Module {}
	return AppModule;
};

describe('ArgusModule', () => {
	afterEach(() => {
		mock.restore();
		(ArgusSDK as any).instance = undefined;
	});

	it('has no bare side-effect imports in its entry point', () => {
		const source = readFileSync(join(import.meta.dir, '../src/index.ts'), 'utf8');
		const bare = source.match(/^import\s+['"][^'"]+['"]/gm) ?? [];
		expect(bare.filter((line) => !line.includes('reflect-metadata'))).toEqual([]);
	});

	it('requires a serviceName', async () => {
		@Module.register({ imports: [ArgusModule] })
		class Bare extends Module {}
		await expect(Application.testing({ modules: [Bare] })).rejects.toBeInstanceOf(
			MissingModuleConfigError
		);
	});

	it('starts the SDK with the resolved config on init', async () => {
		const init = spyOn(ArgusSDK, 'initialize').mockImplementation(() => {});
		const app = await Application.testing({
			modules: [withConfig({ serviceName: 'svc' })],
			boot: 'eager'
		});
		try {
			expect(init).toHaveBeenCalledWith(
				expect.objectContaining({ serviceName: 'svc', enabled: true, exporter: 'console' })
			);
		} finally {
			await app.shutdown();
		}
	});

	it('installs the argus plugin on serve', async () => {
		spyOn(ArgusSDK, 'initialize').mockImplementation(() => {});
		const app = await Application.testing({
			modules: [withConfig({ serviceName: 'svc' })],
			boot: 'eager'
		});
		try {
			const use = mock((_plugin: unknown) => {});
			const instance = app.kernel.moduleInstance(app.kernel.graph.node(ArgusModule)!);
			await instance.onServe({ use } as any);
			expect(use).toHaveBeenCalledTimes(1);
			const installed = (use.mock.calls[0] as unknown[])[0] as any;
			expect(installed).toBeInstanceOf(Elysia);
			expect(installed.config.name).toBe((argusPlugin() as any).config.name);
		} finally {
			await app.shutdown();
		}
	});

	it('shuts the SDK down on destroy when it was started', async () => {
		spyOn(ArgusSDK, 'initialize').mockImplementation(() => {});
		const shutdown = spyOn(ArgusSDK, 'shutdown').mockResolvedValue(undefined);
		const app = await Application.testing({
			modules: [withConfig({ serviceName: 'svc' })],
			boot: 'eager'
		});
		await app.shutdown();
		expect(shutdown).toHaveBeenCalledTimes(1);
	});

	it('leaves a pre-initialised SDK alone', async () => {
		const init = spyOn(ArgusSDK, 'initialize').mockImplementation(() => {});
		const shutdown = spyOn(ArgusSDK, 'shutdown').mockResolvedValue(undefined);
		spyOn(ArgusSDK, 'isInitialized').mockReturnValue(true);
		const app = await Application.testing({
			modules: [withConfig({ serviceName: 'svc' })],
			boot: 'eager'
		});
		await app.shutdown();
		expect(init).not.toHaveBeenCalled();
		expect(shutdown).not.toHaveBeenCalled();
	});

	it('does not shut the SDK down when its init failed', async () => {
		spyOn(ArgusSDK, 'initialize').mockImplementation(() => {
			throw new Error('boom');
		});
		const shutdown = spyOn(ArgusSDK, 'shutdown').mockResolvedValue(undefined);
		const app = await Application.testing({ modules: [withConfig({ serviceName: 'svc' })] }).catch(
			() => undefined
		);
		await app?.shutdown();
		expect(shutdown).not.toHaveBeenCalled();
	});
});
