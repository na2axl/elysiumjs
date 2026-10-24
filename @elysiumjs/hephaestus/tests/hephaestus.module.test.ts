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

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Application } from '@elysiumjs/core';
import { describe, expect, it } from 'bun:test';

import { HephaestusModule } from '../src';
import {
	HephaestusBuildCommand,
	HephaestusDockerCommand,
	HephaestusEmbedCommand
} from '../src/commands';

describe('HephaestusModule', () => {
	it('has no bare side-effect imports in its entry point', () => {
		const source = readFileSync(join(import.meta.dir, '../src/index.ts'), 'utf8');
		const bare = source.match(/^import\s+['"][^'"]+['"]/gm) ?? [];
		expect(bare.filter((line) => !line.includes('reflect-metadata'))).toEqual([]);
	});

	it('contributes the three commands to the graph', async () => {
		const app = await Application.testing({ modules: [HephaestusModule] });
		try {
			const commands = app.kernel.graph.collect('commands').map(({ item }) => item);
			expect(commands).toHaveLength(3);
			expect(commands).toEqual(
				expect.arrayContaining([
					HephaestusBuildCommand,
					HephaestusDockerCommand,
					HephaestusEmbedCommand
				])
			);
		} finally {
			await app.shutdown();
		}
	});
});
