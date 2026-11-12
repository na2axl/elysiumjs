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

import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { NodeBuilder } from '../src/builder/node.builder';

const entry = join(import.meta.dir, 'fixtures', 'node', 'server.ts');

/** The real Node.js binary: `bun run` puts a `node` that runs Bun first on the PATH. */
const nodeBinary =
	Bun.which('node', {
		PATH: (process.env.PATH ?? '')
			.split(':')
			.filter((dir) => !/[\\/]bun-node-/.test(dir))
			.join(':')
	}) ?? 'node';

/** Runs the bundle under `node`, waits until it listens, and requests a route. */
const serveUnderNode = async (bundle: string, path: string) => {
	const port = String(41000 + Math.floor(Math.random() * 1000));
	const child = spawn(nodeBinary, [bundle], { env: { ...process.env, PORT: port } });
	let output = '';
	child.stdout.on('data', (chunk) => (output += chunk));
	child.stderr.on('data', (chunk) => (output += chunk));
	try {
		const deadline = Date.now() + 10_000;
		while (!output.includes('listening')) {
			if (Date.now() > deadline || child.exitCode !== null) throw new Error(output || 'no output');
			await Bun.sleep(50);
		}
		const response = await fetch(`http://127.0.0.1:${port}${path}`);
		return { status: response.status, body: await response.json() };
	} finally {
		child.kill();
	}
};

describe('NodeBuilder', () => {
	let outdir: string;

	beforeEach(async () => {
		outdir = await mkdtemp(join(tmpdir(), 'hephaestus-node-'));
	});

	afterEach(async () => {
		await rm(outdir, { recursive: true, force: true });
	});

	it('bundles an app that serves under Node.js, with decorator metadata emitted', async () => {
		const result = await new NodeBuilder().build({ entry, outdir, sourcemap: false });
		expect(result.outputPath).toBe(join(outdir, 'server.js'));
		expect(result.size).toBeGreaterThan(0);

		const { status, body } = await serveUnderNode(result.outputPath, '/greet/ada');
		expect(status).toBe(200);
		expect(body).toEqual({ message: 'Hello, ada', runtime: 'undefined' });
	}, 30_000);

	it('names the output and writes a source map', async () => {
		const result = await new NodeBuilder().build({
			entry,
			outdir,
			outfile: 'api.js',
			minify: false
		});
		expect(result.outputPath).toBe(join(outdir, 'api.js'));
		expect(await Bun.file(join(outdir, 'api.js.map')).exists()).toBe(true);
	});
});
