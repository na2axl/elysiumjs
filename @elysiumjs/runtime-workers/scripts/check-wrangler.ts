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
 * Gate: an Elysium app runs as a Cloudflare Worker in `wrangler dev`.
 *
 * 1. The app compiles ahead of time for workerd, with no runtime code generation in the bundle.
 * 2. workerd serves its routes, delivers a queue batch to its consumer and runs its cron
 *    handler, with the KV-backed mnemosyne cache in between.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, delimiter, dirname, join } from 'node:path';

import { aot } from 'elysia/plugin/aot/bun';

const dir = join(import.meta.dir, 'worker');
const entry = join(dir, 'app.ts');
const outdir = join(dir, 'dist');
const port = 8787 + (process.pid % 500);
const base = `http://127.0.0.1:${port}`;

/** Finds Node.js on the PATH, skipping the `node` shim that `bun run` puts first. */
function findNode(): string {
	const path = (process.env.PATH ?? '')
		.split(delimiter)
		.filter((dir) => !basename(dir).startsWith('bun-node-'))
		.join(delimiter);
	const node = Bun.which('node', { PATH: path });
	if (!node) throw new Error('Node.js is required to run wrangler.');
	return node;
}

const fail = (message: string): never => {
	throw new Error(message);
};

const build = async () => {
	const result = await Bun.build({
		entrypoints: [entry],
		outdir,
		naming: 'worker.js',
		target: 'browser',
		format: 'esm',
		conditions: ['workerd', 'worker', 'browser'],
		external: ['node:*', 'cloudflare:*'],
		plugins: [aot(entry, { target: 'workerd' })]
	});
	if (!result.success) {
		for (const log of result.logs) console.error(log);
		fail('Could not compile the Worker ahead of time.');
	}
	const bundle = await Bun.file(join(outdir, 'worker.js')).text();
	if (/\bnew Function\b|\beval\(/.test(bundle))
		fail('The Worker bundle generates code at runtime.');
};

/** Retries `check` until it returns a value, for work that happens in the background. */
const eventually = async <T>(what: string, check: () => Promise<T | undefined>): Promise<T> => {
	for (let attempt = 0; attempt < 60; attempt++) {
		const value = await check().catch(() => undefined);
		if (value !== undefined) return value;
		await Bun.sleep(500);
	}
	return fail(`Timed out waiting for ${what}.`);
};

const json = async (response: Response) => ({
	status: response.status,
	body: await response.json()
});

const persist = await mkdtemp(join(tmpdir(), 'elysium-wrangler-'));
let wrangler: ReturnType<typeof Bun.spawn> | undefined;

try {
	await build();

	wrangler = Bun.spawn(
		[
			findNode(),
			join(dirname(Bun.resolveSync('wrangler', import.meta.dir)), '..', 'bin', 'wrangler.js'),
			'dev',
			'--config',
			join(dir, 'wrangler.jsonc'),
			'--port',
			String(port),
			'--ip',
			'127.0.0.1',
			'--persist-to',
			persist,
			'--test-scheduled',
			'--show-interactive-dev-session=false'
		],
		{
			cwd: dir,
			stdout: 'pipe',
			stderr: 'pipe',
			env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: 'true' }
		}
	);
	const logs: string[] = [];
	for (const stream of [wrangler.stdout, wrangler.stderr] as ReadableStream<Uint8Array>[]) {
		void (async () => {
			for await (const chunk of stream) logs.push(new TextDecoder().decode(chunk));
		})();
	}

	try {
		const started = await eventually('wrangler dev to start', () => fetch(`${base}/cron`));
		if (!started.ok) fail(`GET /cron answered ${started.status}: ${await started.text()}`);

		const invalid = await fetch(`${base}/jobs/x`, { method: 'POST' });
		if (invalid.status !== 422) fail(`Expected a validation error, got ${invalid.status}.`);

		const queued = await json(await fetch(`${base}/jobs/abc`, { method: 'POST' }));
		if (queued.status !== 200 || queued.body.queued !== 'abc') {
			fail(`Unexpected response to POST /jobs/abc: ${JSON.stringify(queued)}`);
		}

		await eventually('the queue consumer', async () => {
			const job = await json(await fetch(`${base}/jobs/abc`));
			return job.body.status === 'done' ? job : undefined;
		});

		const scheduled = await fetch(
			`${base}/cdn-cgi/handler/scheduled?cron=${encodeURIComponent('*/5 * * * *')}`
		);
		if (!scheduled.ok) fail(`The scheduled event failed: ${scheduled.status}`);
		await eventually('the cron handler', async () => {
			const cron = await json(await fetch(`${base}/cron`));
			return cron.body.cron === '*/5 * * * *' ? cron : undefined;
		});
	} catch (error) {
		console.error(logs.join(''));
		throw error;
	}

	console.log('Wrangler check passed: routes, queue consumer and cron handler run on workerd.');
} finally {
	wrangler?.kill();
	await wrangler?.exited;
	await rm(outdir, { recursive: true, force: true });
	await rm(persist, { recursive: true, force: true });
}

// The AOT plugin keeps a worker alive.
process.exit(0);
