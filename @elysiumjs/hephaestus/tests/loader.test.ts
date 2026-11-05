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

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { loadConfig } from '../src/config/loader';

describe('loadConfig', () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), 'hephaestus-test-'));
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	it('should throw when no config file exists', async () => {
		await expect(loadConfig(tempDir)).rejects.toThrow('No Hephaestus config found');
	});

	it('should return the defaults, named after the folder, when the config is optional', async () => {
		const config = await loadConfig(tempDir, { optional: true });
		expect(config.output.name).toBe(basename(tempDir));
		expect(config.workers).toEqual({ entry: './src/worker.ts', outfile: 'worker.js' });
	});

	it('should load a JSON config file', async () => {
		const configContent = JSON.stringify({
			output: { name: 'test-app' }
		});
		await writeFile(join(tempDir, 'hephaestus.config.json'), configContent);

		const config = await loadConfig(tempDir);
		expect(config.output.name).toBe('test-app');
		expect(config.entry).toBe('./src/index.ts');
	});

	it('should validate the loaded config', async () => {
		const invalidConfig = JSON.stringify({
			output: {} // missing required 'name'
		});
		await writeFile(join(tempDir, 'hephaestus.config.json'), invalidConfig);

		await expect(loadConfig(tempDir)).rejects.toThrow();
	});

	it('should load a TS config file via import', async () => {
		const tsConfig = `export default { output: { name: 'ts-app' } };`;
		await writeFile(join(tempDir, 'hephaestus.config.ts'), tsConfig);

		const config = await loadConfig(tempDir);
		expect(config.output.name).toBe('ts-app');
	});

	it('should prioritize .ts over .json', async () => {
		const tsConfig = `export default { output: { name: 'ts-app' } };`;
		const jsonConfig = JSON.stringify({ output: { name: 'json-app' } });

		await writeFile(join(tempDir, 'hephaestus.config.ts'), tsConfig);
		await writeFile(join(tempDir, 'hephaestus.config.json'), jsonConfig);

		const config = await loadConfig(tempDir);
		expect(config.output.name).toBe('ts-app');
	});
});
