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

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, test } from 'bun:test';

import { checkPortability } from './check-portability';

let dirs: string[] = [];

async function fixture(files: Record<string, string>): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), 'portability-'));
	dirs = [...dirs, root];
	await mkdir(join(root, 'src'), { recursive: true });
	for (const [name, content] of Object.entries(files)) {
		await writeFile(join(root, 'src', name), content);
	}
	return root;
}

afterEach(async () => {
	await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
	dirs = [];
});

describe('checkPortability', () => {
	test('reports host-specific references and skips comments', async () => {
		const root = await fixture({
			'a.ts': [
				'Bun.sleep(1);',
				'// Bun.sleep',
				'/** process.exit() */',
				"import { x } from 'node:fs';",
				"import { y } from 'node:events';"
			].join('\n')
		});
		const findings = checkPortability([root], {});
		expect(findings.map((f) => [f.line, f.match])).toEqual([
			[1, 'Bun.'],
			[4, "from 'node:"]
		]);
	});

	test('exempts allow-listed files', async () => {
		const root = await fixture({ 'conn.ts': 'Bun.sleep(1);' });
		expect(checkPortability([root], { [root]: ['src/conn.ts'] })).toEqual([]);
	});

	test('catches dynamic, side-effect, require and bare Node imports', async () => {
		const root = await fixture({
			'b.ts': [
				"const a = import('node:fs');",
				"import 'node:fs';",
				"const c = require('node:fs');",
				"import { d } from 'fs';",
				"import { e } from 'fs/promises';",
				"import { f } from 'events';",
				"const g = import('node:events');",
				"import { h } from 'bun';",
				"import { i } from '@scope/fs';",
				'process.exit();'
			].join('\n')
		});
		const lines = checkPortability([root], {}).map((f) => f.line);
		expect(lines).toEqual([1, 2, 3, 4, 5, 8, 10]);
	});

	test('catches optional chaining, bun: builtins, aliases and code after block comments', async () => {
		const root = await fixture({
			'c.ts': [
				'process?.exit(1);',
				'Bun?.sleep(1);',
				"import { Database } from 'bun:sqlite';",
				'/* note */ Bun.sleep(1);',
				'const p = globalThis.process;',
				"const q = globalThis['Bun'];",
				'const r = process;',
				'/*',
				' * Bun.sleep(1) inside a block comment',
				' */',
				"const s = 'ok';"
			].join('\n')
		});
		const lines = checkPortability([root], {}).map((f) => f.line);
		expect([...new Set(lines)]).toEqual([1, 2, 3, 4, 5, 6, 7]);
	});

	test('exempts a line marked with portability-allow, at its end or on the line above', async () => {
		const root = await fixture({
			'd.ts': [
				'const a = globalThis.process?.env; // portability-allow: fallback',
				'// portability-allow: fallback',
				'const b = globalThis.process?.env;',
				'const c = globalThis.process?.env;',
				'const d = globalThis.process?.env; // portability-allow:'
			].join('\n')
		});
		const lines = checkPortability([root], {}).map((f) => f.line);
		expect([...new Set(lines)]).toEqual([4, 5]);
	});
});
