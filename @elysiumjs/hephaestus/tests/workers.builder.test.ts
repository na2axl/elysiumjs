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

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { WorkersBuilder } from '../src/builder/workers.builder';

const fixtures = join(import.meta.dir, 'fixtures', 'worker');

describe('WorkersBuilder', () => {
	let outdir: string;

	beforeEach(async () => {
		outdir = await mkdtemp(join(tmpdir(), 'hephaestus-workers-'));
	});

	afterEach(async () => {
		await rm(outdir, { recursive: true, force: true });
	});

	it('bundles the entry with its routes compiled ahead of time', async () => {
		const result = await new WorkersBuilder().build({
			entry: join(fixtures, 'entry.ts'),
			outdir,
			sourcemap: false
		});

		expect(result.outputPath).toBe(join(outdir, 'worker.js'));
		expect(result.size).toBeGreaterThan(0);
		expect(result.gzipSize).toBeLessThan(result.size);
		expect(await Bun.file(join(outdir, 'worker.js.map')).exists()).toBe(false);

		const bundle = await Bun.file(result.outputPath).text();
		expect(bundle).not.toMatch(/\bnew Function\b|\beval\(/);

		const { default: worker } = await import(result.outputPath);
		const response: Response = await worker.fetch(
			new Request('http://localhost/echo/abc', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ note: 'hi' })
			})
		);
		expect(await response.json()).toEqual({ id: 'abc', note: 'hi' });
	});

	it('names the output and writes a source map', async () => {
		const result = await new WorkersBuilder().build({
			entry: join(fixtures, 'entry.ts'),
			outdir,
			outfile: 'api.js',
			minify: false
		});
		expect(result.outputPath).toBe(join(outdir, 'api.js'));
		expect(await Bun.file(join(outdir, 'api.js.map')).exists()).toBe(true);
	});

	it('fails when the entry does not export its Elysia app', async () => {
		expect(
			new WorkersBuilder().build({ entry: join(fixtures, 'no-app.ts'), outdir })
		).rejects.toThrow();
	});
});
