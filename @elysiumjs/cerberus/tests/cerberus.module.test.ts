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

import {
	Application,
	MissingModuleConfigError,
	Module,
	ModuleContext,
	Service,
	ServiceNotVisibleError
} from '@elysiumjs/core';
import { describe, expect, it } from 'bun:test';

import { CERBERUS_CONFIG, CerberusMiddleware, CerberusModule } from '../src';

const cfg = { getSubject: async () => ({ id: 'u1' }) };

@Module.register({ imports: [CerberusModule.with(cfg)] })
class ConsumerModule extends Module {}

@Module.register({})
class UnrelatedModule extends Module {}

@Module.register({ imports: [CerberusModule] })
class PlainModule extends Module {}

describe('CerberusModule', () => {
	it('has no bare side-effect imports in its entry point', () => {
		const source = readFileSync(join(import.meta.dir, '../src/index.ts'), 'utf8');
		const bare = source.match(/^import\s+['"][^'"]+['"]/gm) ?? [];
		expect(bare).toEqual([]);
	});

	it('uses a stable config token', () => {
		expect(CerberusModule.config).toBe(CERBERUS_CONFIG);
	});

	it('rejects a boot without a config', async () => {
		await expect(Application.testing({ modules: [PlainModule] })).rejects.toBeInstanceOf(
			MissingModuleConfigError
		);
	});

	it('injects the module config into a middleware built inside an importing module', async () => {
		const app = await Application.testing({ modules: [ConsumerModule], boot: 'eager' });
		try {
			const node = app.kernel.graph.node(ConsumerModule)!;
			const middleware = ModuleContext.run(node, () => Service.make(CerberusMiddleware));
			expect((middleware as any).config.getSubject).toBe(cfg.getSubject);
		} finally {
			await app.shutdown();
		}
	});

	it('resolves the config token and the middleware from an importing module', async () => {
		const app = await Application.testing({ modules: [ConsumerModule], boot: 'eager' });
		try {
			expect(((await app.get(CERBERUS_CONFIG, ConsumerModule)) as any).getSubject).toBe(
				cfg.getSubject
			);
			expect(await app.get(CerberusMiddleware, ConsumerModule)).toBeInstanceOf(CerberusMiddleware);
		} finally {
			await app.shutdown();
		}
	});

	it('cannot be constructed from an unrelated module', async () => {
		const app = await Application.testing({
			modules: [ConsumerModule, UnrelatedModule],
			boot: 'eager'
		});
		try {
			const node = app.kernel.graph.node(UnrelatedModule)!;
			expect(() => ModuleContext.run(node, () => Service.make(CerberusMiddleware))).toThrow(
				ServiceNotVisibleError
			);
		} finally {
			await app.shutdown();
		}
	});
});
