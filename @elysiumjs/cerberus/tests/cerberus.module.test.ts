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

import {
	Application,
	Module,
	ModuleContext,
	Service,
	ServiceNotVisibleError
} from '@elysiumjs/core';
import { describe, expect, it } from 'bun:test';

import { CerberusMiddleware, CerberusModule } from '../src';

const cfg = { getSubject: async () => ({ id: 'u1' }) };

@Module.register({ imports: [CerberusModule.with(cfg)] })
class ConsumerModule extends Module {}

@Module.register({})
class UnrelatedModule extends Module {}

describe('CerberusModule', () => {
	it('registers nothing on import', () => {
		expect(Service.keys('*')).toEqual([]);
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

	it('cannot be constructed from an unrelated module', async () => {
		const app = await Application.testing({ modules: [ConsumerModule, UnrelatedModule], boot: 'eager' });
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
