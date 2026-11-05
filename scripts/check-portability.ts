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
 * Portability gate: runtime-agnostic packages must not reference host-specific APIs, so they stay
 * runnable on Bun, Node.js and Cloudflare Workers. Host APIs belong in the runtime packages.
 */

import { readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { join, relative } from 'node:path';

import { Glob } from 'bun';

/** A host-specific reference found in a source file. */
export type PortabilityFinding = { file: string; line: number; match: string };

/** Node.js modules available on Workers under nodejs_compat. */
const ALLOWED_NODE_MODULES = ['async_hooks', 'buffer', 'events'];

const BARE_BUILTINS = builtinModules
	.filter(
		(name) =>
			!name.startsWith('_') && !name.startsWith('bun') && !ALLOWED_NODE_MODULES.includes(name)
	)
	.map((name) => name.replace(/[/]/g, '\\/'))
	.join('|');

// Covers `from '…'`, `import('…')`, side-effect `import '…'` and `require('…')`.
const SPECIFIER = String.raw`(?:from\s*|import\s*\(\s*|import\s*|require\s*\(\s*)['"]`;

const PATTERNS: RegExp[] = [
	/\bBun\./,
	new RegExp(`${SPECIFIER}bun['"]`),
	/\bprocess\./,
	new RegExp(`${SPECIFIER}node:(?!${ALLOWED_NODE_MODULES.join('|')})`),
	new RegExp(`${SPECIFIER}(?:${BARE_BUILTINS})['"]`)
];

/** Packages scanned by the gate, relative to the repository root. */
export const ROOTS = [
	'@elysiumjs/core',
	'@elysiumjs/cerberus',
	'@elysiumjs/argus',
	'@elysiumjs/hermes',
	'@elysiumjs/mnemosyne',
	'@elysiumjs/redis',
	'@elysiumjs/heracles',
	'@elysiumjs/plugin-sentry'
];

/** Files exempt from the gate, per root. Globs are relative to the root. */
export const ALLOW: Record<string, string[]> = {
	// The Bun adapter of the Redis connection port.
	'@elysiumjs/redis': ['src/connection.ts'],
	// A lazy `import('node:readline')`, only reached after `Runtime.terminal()` returned a terminal
	// (never on Workers). Readline should move into the runtime packages later.
	'@elysiumjs/core': ['src/console.ts']
};

function isComment(line: string): boolean {
	const text = line.trim();
	return text.startsWith('//') || text.startsWith('*') || text.startsWith('/*');
}

/**
 * Scans `src/**\/*.ts` of each root for host-specific references.
 *
 * @param roots Package directories to scan.
 * @param allow Maps a root to the file globs (relative to it) that are exempt.
 * @returns One finding per offending line and pattern.
 *
 * @author Axel Nana <axel.nana@workbud.com>
 */
export function checkPortability(
	roots: string[],
	allow: Record<string, string[]>
): PortabilityFinding[] {
	const findings: PortabilityFinding[] = [];
	for (const root of roots) {
		const exempt = (allow[root] ?? []).map((pattern) => new Glob(pattern));
		const files = [...new Glob('src/**/*.ts').scanSync({ cwd: root })].sort();
		for (const path of files) {
			if (exempt.some((glob) => glob.match(path))) continue;
			const file = join(root, path);
			readFileSync(file, 'utf8')
				.split('\n')
				.forEach((text, index) => {
					if (isComment(text)) return;
					for (const pattern of PATTERNS) {
						const match = pattern.exec(text);
						if (match) findings.push({ file, line: index + 1, match: match[0] });
					}
				});
		}
	}
	return findings;
}

if (import.meta.main) {
	const base = join(import.meta.dir, '..');
	const roots = ROOTS.map((root) => join(base, root));
	const allow = Object.fromEntries(Object.entries(ALLOW).map(([k, v]) => [join(base, k), v]));
	const findings = checkPortability(roots, allow);
	for (const { file, line, match } of findings) {
		console.error(`${relative(base, file)}:${line}: host-specific API \`${match}\``);
	}
	if (findings.length > 0) process.exit(1);
	console.log('Portability check passed.');
}
