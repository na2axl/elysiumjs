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
 * Gate: an Elysium app compiles ahead of time with `elysia/plugin/aot` for workerd.
 *
 * 1. The bundle holds no runtime code generation (`new Function`, `eval`), which workerd forbids.
 * 2. It serves a validated route under Node.js with code generation from strings disallowed.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, delimiter, join } from 'node:path';

import { aot } from 'elysia/plugin/aot/bun';

const entry = join(import.meta.dir, 'aot/app.ts');

/** Finds Node.js on the PATH, skipping the `node` shim that `bun run` puts first. */
function findNode(): string {
	const path = (process.env.PATH ?? '')
		.split(delimiter)
		.filter((dir) => !basename(dir).startsWith('bun-node-'))
		.join(delimiter);
	const node = Bun.which('node', { PATH: path });
	if (!node) throw new Error('Node.js is required to run the AOT check.');
	return node;
}

const outdir = await mkdtemp(join(tmpdir(), 'elysium-aot-'));

try {
	const result = await Bun.build({
		entrypoints: [entry],
		outdir,
		naming: 'app.js',
		target: 'browser',
		format: 'esm',
		conditions: ['workerd', 'worker', 'browser'],
		external: ['node:*', 'cloudflare:*'],
		plugins: [aot(entry, { target: 'workerd' })]
	});
	if (!result.success) {
		for (const log of result.logs) console.error(log);
		throw new Error('Could not compile the app ahead of time.');
	}

	const bundle = await Bun.file(join(outdir, 'app.js')).text();
	const codegen = bundle
		.split('\n')
		.map((line, index) => ({ line: line.trim(), number: index + 1 }))
		.filter(({ line }) => /\bnew Function\b|\beval\(/.test(line));
	if (codegen.length > 0) {
		for (const { line, number } of codegen)
			console.error(`app.js:${number}: ${line.slice(0, 200)}`);
		throw new Error('The AOT bundle still generates code at runtime.');
	}

	const proc = Bun.spawn(
		[
			findNode(),
			'--disallow-code-generation-from-strings',
			join(import.meta.dir, 'aot/requests.mjs'),
			join(outdir, 'app.js')
		],
		{ stdout: 'inherit', stderr: 'inherit' }
	);
	if ((await proc.exited) !== 0)
		throw new Error('The AOT bundle does not serve requests without code generation.');

	console.log('AOT check passed: the app compiles ahead of time for workerd.');
} finally {
	await rm(outdir, { recursive: true, force: true });
}

// The AOT plugin keeps a worker alive.
process.exit(0);
