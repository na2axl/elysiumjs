// Copyright (c) 2025-present Axel Nana <ax.lnana@outlook.com>. All rights reserved.
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

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

// The workerd AOT lane. `scripts/build-aot.ts` (run by `pretest:workerd-aot`) compiles one Worker
// per scenario ahead of time into `.aot/<index>/worker.js`. Each runs here as an auxiliary Worker,
// as a deployed Worker runs: without `unsafeEval`, so any code generated from strings at request
// time fails the lane. The tests reach each Worker through a service binding, `AOT_<index>`.
const root = join(import.meta.dirname, '.aot');
const manifest = join(root, 'scenarios.json');
if (!existsSync(manifest)) {
	throw new Error('Build the AOT Workers first: bun scripts/build-aot.ts');
}
const names: string[] = JSON.parse(readFileSync(manifest, 'utf8'));

const compatibility = { compatibilityDate: '2025-09-01', compatibilityFlags: ['nodejs_compat'] };

export default defineConfig({
	plugins: [
		cloudflareTest({
			miniflare: {
				...compatibility,
				serviceBindings: Object.fromEntries(names.map((_, i) => [`AOT_${i}`, `aot-${i}`])),
				workers: names.map((_, i) => ({
					...compatibility,
					name: `aot-${i}`,
					modules: true,
					scriptPath: join(root, String(i), 'worker.js'),
					kvNamespaces: { CACHE: 'elysium-conformance-cache' }
				}))
			}
		})
	],
	test: {
		include: ['tests/workerd-aot/**/*.test.ts'],
		provide: { aotScenarios: names }
	}
});
