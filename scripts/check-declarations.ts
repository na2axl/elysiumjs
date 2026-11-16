// Copyright (c) 2026-present Axel Nana <ax.lnana@outlook.com>. All rights reserved.
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
 * Declarations gate: the published `.d.ts` files must resolve for every consumer, whatever its
 * `moduleResolution`. The script installs the built packages into a throwaway consumer project,
 * imports every `exports` entry, and compiles it with `skipLibCheck: false` under each
 * resolution mode. Any error reported inside an `@elysiumjs/*` declaration file fails the gate:
 * an import TypeScript cannot resolve there turns every symbol behind it into `any`.
 *
 * Run it after `bun run build`.
 */

import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '..');
const SCOPE = join(ROOT, '@elysiumjs');

/** The module settings a consumer may compile with. */
const MODES = [
	{ module: 'nodenext', moduleResolution: 'nodenext' },
	{ module: 'node16', moduleResolution: 'node16' },
	{ module: 'esnext', moduleResolution: 'bundler' }
];

type Manifest = {
	name: string;
	private?: boolean;
	types?: string;
	exports?: Record<string, unknown>;
};

/**
 * Lists the specifiers a consumer can import from a package: each `exports` entry that declares
 * types, or the package root when it has no `exports`.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @param manifest The package manifest.
 */
function entriesOf(manifest: Manifest): string[] {
	if (!manifest.exports) return manifest.types ? [manifest.name] : [];
	return Object.entries(manifest.exports)
		.filter(([, target]) => typeof target === 'object' && target !== null && 'types' in target)
		.map(([key]) => (key === '.' ? manifest.name : `${manifest.name}/${key.slice(2)}`));
}

const packages = readdirSync(SCOPE)
	.map((dir) => ({
		dir: join(SCOPE, dir),
		manifest: JSON.parse(readFileSync(join(SCOPE, dir, 'package.json'), 'utf8')) as Manifest
	}))
	.filter(({ manifest }) => !manifest.private);

const missing = packages.filter(({ dir }) => !existsSync(join(dir, 'dist')));
if (missing.length > 0) {
	console.error(
		`Build the packages first (no dist in ${missing.map((p) => p.manifest.name).join(', ')}).`
	);
	process.exit(1);
}

const consumer = mkdtempSync(join(tmpdir(), 'elysium-declarations-'));
const failures: string[] = [];

try {
	mkdirSync(join(consumer, 'node_modules', '@elysiumjs'), { recursive: true });
	for (const { dir, manifest } of packages) {
		symlinkSync(dir, join(consumer, 'node_modules', manifest.name), 'dir');
	}

	const specifiers = packages.flatMap(({ manifest }) => entriesOf(manifest));
	writeFileSync(
		join(consumer, 'package.json'),
		JSON.stringify({ name: 'consumer', private: true, type: 'module' })
	);
	writeFileSync(
		join(consumer, 'index.ts'),
		specifiers.map((specifier, i) => `export * as entry${i} from '${specifier}';`).join('\n') + '\n'
	);

	// Workers apps get `cloudflare:workers` from `@cloudflare/workers-types` or `wrangler types`;
	// the consumer uses the slice the workers package declares for its own type check.
	copyFileSync(
		join(SCOPE, 'workers', 'src', 'cloudflare-workers.d.ts'),
		join(consumer, 'cloudflare-workers.d.ts')
	);

	const tsc = join(ROOT, 'node_modules', '.bin', 'tsc');
	for (const mode of MODES) {
		writeFileSync(
			join(consumer, 'tsconfig.json'),
			JSON.stringify({
				compilerOptions: {
					...mode,
					target: 'esnext',
					strict: true,
					noEmit: true,
					skipLibCheck: false,
					types: []
				},
				files: ['cloudflare-workers.d.ts', 'index.ts']
			})
		);
		const run = Bun.spawnSync([tsc, '-p', consumer, '--pretty', 'false'], { cwd: consumer });
		const output = run.stdout.toString() + run.stderr.toString();
		// Errors in third-party declarations are not ours to fix; errors in the consumer file or in
		// an Elysium declaration are.
		const ours = output
			.split('\n')
			.filter((line) => /error TS\d+/.test(line))
			.filter((line) => line.startsWith('index.ts') || /@elysiumjs\/[^/]+\/dist\//.test(line));
		for (const line of ours) failures.push(`[${mode.moduleResolution}] ${line}`);
	}
} finally {
	rmSync(consumer, { recursive: true, force: true });
}

if (failures.length > 0) {
	console.error(failures.join('\n'));
	console.error(
		`\n${failures.length} declaration error(s): every published import must resolve for consumers.`
	);
	process.exit(1);
}

console.log(`Declarations resolve under ${MODES.map((m) => m.moduleResolution).join(', ')}.`);
