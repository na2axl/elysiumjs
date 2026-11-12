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

/**
 * Gate: the Workers runtime bundles for workerd without touching the `Bun` global.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const outdir = await mkdtemp(join(tmpdir(), 'elysium-runtime-workers-'));

try {
	const result = await Bun.build({
		entrypoints: [join(import.meta.dir, '../src/index.ts')],
		outdir,
		target: 'browser',
		format: 'esm',
		conditions: ['workerd', 'worker', 'browser'],
		packages: 'external'
	});
	if (!result.success) {
		for (const log of result.logs) console.error(log);
		throw new Error('Could not bundle @elysiumjs/runtime-workers.');
	}

	const bundle = await Bun.file(join(outdir, 'index.js')).text();
	if (/\bBun\b/.test(bundle)) throw new Error('The Workers runtime uses the Bun global.');

	console.log('Runtime check passed: the Workers runtime does not use the Bun global.');
} finally {
	await rm(outdir, { recursive: true, force: true });
}
