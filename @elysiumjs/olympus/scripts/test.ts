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
 * Runs each domain's tests in its own `bun test` process, so registries filled by one domain's
 * tests never leak into another's. Extra arguments are passed to every run.
 */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..');
const testsDir = join(root, 'tests');
const domains = readdirSync(testsDir, { withFileTypes: true })
	.filter((entry) => entry.isDirectory())
	.map((entry) => entry.name)
	.sort((a, b) => (a === 'core' ? -1 : b === 'core' ? 1 : a.localeCompare(b)));

const args = process.argv.slice(2);
let failed = false;

for (const domain of domains) {
	const dir = join(testsDir, domain);
	const preload = join(dir, 'setup.ts');
	const command = [
		'bun',
		'test',
		...(existsSync(preload) ? ['--preload', preload] : []),
		...args,
		// Each run writes its own coverage report, so one domain's report never replaces another's.
		`--coverage-dir=./coverage/${domain}`,
		`./tests/${domain}/`
	];
	console.log(`\n# ${domain}\n`);
	const run = Bun.spawnSync(command, { cwd: root, stdout: 'inherit', stderr: 'inherit', env: process.env });
	if (run.exitCode !== 0) failed = true;
}

process.exit(failed ? 1 : 0);
