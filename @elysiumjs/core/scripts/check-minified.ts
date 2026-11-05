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

/**
 * Gate: services resolve in a minified build, where the bundler renames classes.
 *
 * 1. The app bundles with every identifier minified, and its class names are gone.
 * 2. The bundle serves requests that resolve services by class, by name, by parameter type, and
 *    request-scoped.
 */

import { rm } from 'node:fs/promises';
import { join } from 'node:path';

const root = join(import.meta.dir, '..');
// Inside the package, so that Elysia and the other dependencies resolve from its node_modules.
const outdir = join(root, `.minified-check-${process.pid}`);

try {
	const result = await Bun.build({
		entrypoints: [join(import.meta.dir, 'minified/app.ts')],
		outdir,
		naming: 'app.js',
		target: 'bun',
		format: 'esm',
		packages: 'external',
		minify: true
	});
	if (!result.success) {
		for (const log of result.logs) console.error(log);
		throw new Error('Could not bundle the app.');
	}

	const bundle = await Bun.file(join(outdir, 'app.js')).text();
	const kept = ['ClockService', 'ReportService', 'RequestState', 'ReportController'].filter(
		(name) => new RegExp(`class ${name}\\b`).test(bundle)
	);
	if (kept.length > 0) {
		throw new Error(`The bundle kept class names (${kept.join(', ')}), so it checks nothing.`);
	}

	const proc = Bun.spawn([process.execPath, join(outdir, 'app.js')], {
		cwd: root,
		stdout: 'inherit',
		stderr: 'inherit'
	});
	if ((await proc.exited) !== 0)
		throw new Error('A service did not resolve in the minified build.');

	console.log('Minified build check passed.');
} finally {
	await rm(outdir, { recursive: true, force: true });
}
