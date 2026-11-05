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
 * Gate for running core outside Bun (Cloudflare Workers first):
 *
 * 1. The core bundle never touches the `Bun` global: host APIs come from a runtime package.
 * 2. The bundle loads and boots an application under Node.js, where `Bun` does not exist.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, delimiter, join } from 'node:path';

const root = join(import.meta.dir, '..');

/** Finds Node.js on the PATH, skipping the `node` shim that `bun run` puts first. */
function findNode(): string {
	const path = (process.env.PATH ?? '')
		.split(delimiter)
		.filter((dir) => !basename(dir).startsWith('bun-node-'))
		.join(delimiter);
	const node = Bun.which('node', { PATH: path });
	if (!node) throw new Error('Node.js is required to run the runtime check.');
	return node;
}

const outdir = await mkdtemp(join(tmpdir(), 'elysium-core-runtime-'));

try {
	const result = await Bun.build({
		entrypoints: [join(root, 'src/index.ts')],
		outdir,
		target: 'node',
		format: 'esm',
		packages: 'external'
	});
	if (!result.success) {
		for (const log of result.logs) console.error(log);
		throw new Error('Could not bundle @elysiumjs/core.');
	}

	const bundle = await Bun.file(join(outdir, 'index.js')).text();
	const bunReferences = bundle
		.split('\n')
		.map((line, index) => ({ line: line.trim(), number: index + 1 }))
		.filter(({ line }) => /\bBun\b/.test(line));
	if (bunReferences.length > 0) {
		for (const { line, number } of bunReferences) console.error(`index.js:${number}: ${line}`);
		throw new Error('The core bundle uses the Bun global.');
	}

	// Elysia and the other dependencies resolve from core's node_modules.
	const entry = join(root, `.runtime-check-${process.pid}.mjs`);
	await Bun.write(join(root, `.runtime-check-${process.pid}.bundle.mjs`), bundle);
	await Bun.write(
		entry,
		`
const core = await import('./.runtime-check-${process.pid}.bundle.mjs');
if (core.Runtime.find() !== undefined) throw new Error('Core must not pick a runtime by itself.');
const runtime = { name: 'check', env: () => process.env, sleep: async () => {}, serve() {}, exit() {}, onShutdown: () => () => {} };
class App extends core.Application {}
core.Application.register({ runtime, modules: [] })(App);
process.env.ELYSIUM_RUNTIME_CHECK = 'ok';
new App();
if (core.Runtime.get() !== runtime) throw new Error('The runtime option was not applied.');
if (core.Env.get('ELYSIUM_RUNTIME_CHECK') !== 'ok') throw new Error('The environment was not read through the runtime.');
console.log(core.InteractsWithConsole.name, 'loaded and booted under Node.js', process.version);
`
	);
	try {
		const proc = Bun.spawn([findNode(), entry], {
			cwd: root,
			stdout: 'inherit',
			stderr: 'inherit'
		});
		if ((await proc.exited) !== 0) throw new Error('The core bundle does not load under Node.js.');
	} finally {
		await rm(entry, { force: true });
		await rm(join(root, `.runtime-check-${process.pid}.bundle.mjs`), { force: true });
	}

	console.log('Runtime check passed: core does not use the Bun global.');
} finally {
	await rm(outdir, { recursive: true, force: true });
}
