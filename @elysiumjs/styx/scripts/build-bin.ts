// Copyright (c) 2026-present Workbud Technologies Inc. All rights reserved.
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
 * Builds the standalone `styx` executables with Hephaestus: the stubs and project templates are
 * embedded in the binary, so it runs without the package files and without Bun installed.
 *
 * Usage: `bun run build:bin` for the current platform, `bun run build:bin --all` for every one.
 */
import type { PlatformTarget } from '@elysiumjs/hephaestus';

import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import {
	AssetEmbedder,
	BinaryBuilder,
	HephaestusConfigSchema,
	PlatformTargetSchema
} from '@elysiumjs/hephaestus';

const root = resolve(import.meta.dir, '..');
const outDir = join(root, 'dist', 'bin');
const all = process.argv.includes('--all');

process.chdir(root);
await mkdir(outDir, { recursive: true });

const config = HephaestusConfigSchema.parse({
	entry: join(outDir, 'main.ts'),
	output: { name: 'styx', dir: outDir },
	platforms: all ? (PlatformTargetSchema.options as PlatformTarget[]) : [],
	build: { sourcemap: false },
	assets: { embed: ['stubs/**', 'templates/**'], exclude: ['**/node_modules/**', '**/bun.lock'] }
});

// The asset loader paths are relative to the package root, as `readAsset` expects them.
await Bun.write(join(outDir, 'assets.ts'), await new AssetEmbedder(config).embed());
await Bun.write(
	config.entry,
	`import * as assets from './assets';
import { useEmbeddedAssets } from '../../src/assets';

useEmbeddedAssets(assets);
await import('../../src/cli');
`
);

for (const result of await new BinaryBuilder(config).buildAll()) {
	const size = (result.size / 1024 / 1024).toFixed(1);
	console.log(`${result.platform}: ${result.outputPath} (${size} MB, ${result.duration} ms)`);
}
