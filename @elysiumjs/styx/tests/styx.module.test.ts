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

import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';

import { Application, ElysiumError } from '@elysiumjs/core';

import { StyxModule } from '../src';
import { AppEntryNotFoundError, resolveAppEntry } from '../src/utils';

const fixture = (name: string) => join(import.meta.dir, 'fixtures', name);

describe('StyxModule', () => {
	it('is skipped under production', async () => {
		const app = await Application.testing({ modules: [StyxModule], environment: 'production' });
		try {
			expect(app.kernel.graph.skipped).toContain(StyxModule);
			expect(app.kernel.graph.nodes.map((n) => n.id)).not.toContain('StyxModule');
		} finally {
			await app.shutdown();
		}
	});

	it('is loaded under development', async () => {
		const app = await Application.testing({ modules: [StyxModule], environment: 'development' });
		try {
			expect(app.kernel.graph.skipped).not.toContain(StyxModule);
			expect(app.kernel.graph.nodes.map((n) => n.id)).toContain('StyxModule');
		} finally {
			await app.shutdown();
		}
	});
});

describe('resolveAppEntry', () => {
	it('prefers src/app.ts over index.ts', async () => {
		const App = await resolveAppEntry(fixture('src-app'));
		expect(App.name).toBe('FromSrcApp');
		expect(App.prototype).toBeInstanceOf(Application);
	});

	it('falls back to index.ts', async () => {
		const App = await resolveAppEntry(fixture('index-only'));
		expect(App.name).toBe('FromIndexApp');
	});

	it('throws the exact message when no Application is exported', async () => {
		const path = fixture('no-app');
		const error = await resolveAppEntry(path).catch((e) => e);
		expect(error).toBeInstanceOf(AppEntryNotFoundError);
		expect(error).toBeInstanceOf(ElysiumError);
		expect(error.message).toBe(`Could not find an exported Application class in ${path}/index.ts`);
	});
});
