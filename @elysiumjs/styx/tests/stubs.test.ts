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

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, mkdir, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { addToModuleHint } from '../src/config';
import { createModule } from '../src/utils';

const stubsDir = join(import.meta.dir, '..', 'stubs');
const importPattern = /^import \{([^}]+)\} from '(@elysiumjs\/[^']+)';$/gm;

describe('stub imports', () => {
	it('has stubs to check', async () => {
		expect((await readdir(stubsDir)).filter((f) => f.endsWith('.stub'))).toHaveLength(10);
	});

	for (const file of [
		'command',
		'http.controller',
		'job',
		'middleware',
		'model',
		'repository',
		'service',
		'validator',
		'wamp.controller',
		'ws.controller'
	]) {
		it(`${file}.stub imports only names its package exports`, async () => {
			const text = await Bun.file(join(stubsDir, `${file}.stub`)).text();
			for (const [, names, pkg] of text.matchAll(importPattern)) {
				const exports = (await import(pkg)) as Record<string, unknown>;
				for (const name of names.split(',').map((n) => n.trim())) {
					expect(name in exports, `${name} is not exported by ${pkg}`).toBe(true);
				}
			}
		});
	}
});

describe('generator output', () => {
	let dir: string;
	const cwd = process.cwd();

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), 'styx-'));
		process.chdir(dir);
	});

	afterEach(async () => {
		process.chdir(cwd);
		await rm(dir, { recursive: true, force: true });
	});

	const rc = (config: object) => Bun.write(join(dir, '.elysiumrc'), JSON.stringify(config));

	describe('addToModuleHint', () => {
		it('names the main module in a mono project', async () => {
			await rc({ projectName: 'x', mono: true });
			expect(await addToModuleHint('jobs', 'SendJob')).toBe(
				'Add SendJob to the jobs list of MainModule in ./src/main.module.ts.'
			);
		});

		it('names the chosen module in a multi-module project', async () => {
			await rc({ projectName: 'x', mono: false, modules: { billing: './src/modules/billing' } });
			expect(await addToModuleHint('services', 'PayService', 'billing')).toBe(
				'Add PayService to the services list of BillingModule in ./src/modules/billing/billing.module.ts.'
			);
		});

		it('falls back to a generic hint when no module is chosen', async () => {
			await rc({ projectName: 'x', mono: false, modules: { billing: './src/modules/billing' } });
			const hint = await addToModuleHint('commands', 'DoCommand');
			expect(hint).toBe('Add DoCommand to the commands list of the module that should own it.');
			expect(hint).not.toContain('undefined');
		});
	});

	describe('createModule', () => {
		it('writes a module file with empty lists', async () => {
			await rc({ projectName: 'x', mono: false, modules: {} });
			await mkdir(join(dir, 'src'), { recursive: true });
			await Bun.write(join(dir, 'package.json'), '{}');

			await createModule('billing');

			const text = await Bun.file(join(dir, 'src/modules/billing/billing.module.ts')).text();
			expect(text).toContain('@Module.register({');
			expect(text).toContain('services: []');
			expect(text).toContain('controllers: []');
			expect(text).toContain('commands: []');
			expect(text).toContain('export class BillingModule extends Module {}');
		});
	});
});
