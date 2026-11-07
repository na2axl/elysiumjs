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

import type { BunPlugin } from 'bun';

import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { basename, dirname, join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

/** Stands for a class of `cloudflare:workers` while the entry is imported at build time. */
class BuildTimeStub {}

/**
 * The `cloudflare:*` modules, as the AOT plugin sees them when it imports the entry in Bun to
 * compile its routes: Bun has no such modules, so classes and functions that do nothing stand
 * for their exports. A Durable Object class exported by the entry can then extend
 * `DurableObject`. The bundle keeps the real imports, which workerd provides.
 */
const CLOUDFLARE_STUBS: Record<string, Record<string, unknown>> = {
	'cloudflare:workers': {
		DurableObject: BuildTimeStub,
		WorkerEntrypoint: BuildTimeStub,
		WorkflowEntrypoint: BuildTimeStub,
		RpcTarget: BuildTimeStub,
		RpcStub: BuildTimeStub,
		env: {},
		waitUntil: () => {}
	},
	'cloudflare:email': { EmailMessage: BuildTimeStub },
	'cloudflare:sockets': { connect: () => ({}) }
};

let stubbed = false;

/** Registers the `cloudflare:*` stubs with Bun's runtime, once per process. */
const stubCloudflareModules = (): void => {
	if (stubbed) return;
	stubbed = true;
	Bun.plugin({
		name: 'elysium-cloudflare-stubs',
		setup(build) {
			for (const [specifier, exports] of Object.entries(CLOUDFLARE_STUBS)) {
				build.module(specifier, () => ({ exports, loader: 'object' }));
			}
		}
	});
};

/**
 * Options of {@link WorkersBuilder.build}.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export interface WorkersBuildOptions {
	/** The Worker entry: it exports the handlers as default and the root Elysia app as `app`. */
	entry: string;
	/** The output folder. */
	outdir: string;
	/** The output file name. Defaults to `worker.js`. */
	outfile?: string;
	/** Whether to minify the bundle. Defaults to `true`. */
	minify?: boolean;
	/** Whether to write a linked source map. Defaults to `true`. */
	sourcemap?: boolean;
	/** Bun plugins run after the built-in ones. */
	plugins?: BunPlugin[];
}

/**
 * Result of a Worker build.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export interface WorkersBuildResult {
	outputPath: string;
	size: number;
	gzipSize: number;
	duration: number;
}

/** Statements workerd refuses at runtime. */
const CODEGEN = /\bnew Function\b|\beval\(/;

/** A bare package name, such as `pino` or `@scope/name`, without a subpath. */
const BARE_PACKAGE = /^(?:@[^/]+\/)?[^./:][^/:]*$/;

/** The Node.js modules, by their bare names (`fs`, `readline`, ...). */
const NODE_MODULES = new Set(builtinModules.filter((name) => !name.startsWith('_')));

/**
 * Resolves packages to their `browser` entry (the string form of the `browser` field), such as
 * pino's console build: Bun skips that field for modules the AOT plugin loads, which would pull
 * the Node.js build into the Worker. Also leaves Node.js modules imported by their bare names to
 * workerd, which provides them with the `nodejs_compat` flag. A CommonJS `require()` of one
 * throws when it runs, so packages load such modules only where they run on Workers.
 */
const browserEntries: BunPlugin = {
	name: 'elysium-browser-entries',
	setup(build) {
		build.onResolve({ filter: BARE_PACKAGE }, (args) => {
			// Node.js modules come from workerd (`nodejs_compat`), under their `node:` name.
			if (NODE_MODULES.has(args.path)) return { path: `node:${args.path}`, external: true };
			if (!args.importer) return undefined;
			try {
				const manifest = Bun.resolveSync(`${args.path}/package.json`, dirname(args.importer));
				const { browser } = JSON.parse(readFileSync(manifest, 'utf8')) as { browser?: unknown };
				if (typeof browser === 'string') return { path: join(dirname(manifest), browser) };
			} catch {
				// No readable manifest (or none exported): let Bun resolve the package.
			}
			return undefined;
		});
	}
};

/**
 * Leaves `.wasm` imports to workerd, which loads them as compiled WebAssembly modules (what
 * `WebAssembly.compile()` would give, which workerd forbids at runtime). Bun's `file` loader would
 * turn the import into a path string, so the import stays external and the file is copied next to
 * the bundle. Files of the same name from different packages are told apart by a numeric suffix.
 * @param outdir The output folder.
 */
const wasmModules = (outdir: string): BunPlugin => {
	const copied = new Map<string, string>();
	const taken = new Set<string>();
	return {
		name: 'elysium-wasm-modules',
		setup(build) {
			build.onResolve({ filter: /\.wasm$/ }, (args) => {
				const from = args.importer ? dirname(args.importer) : process.cwd();
				const source = args.path.startsWith('.')
					? resolve(from, args.path)
					: Bun.resolveSync(args.path, from);
				let name = copied.get(source);
				if (!name) {
					const stem = basename(source, '.wasm');
					name = `${stem}.wasm`;
					for (let n = 2; taken.has(name); n++) name = `${stem}-${n}.wasm`;
					taken.add(name);
					copied.set(source, name);
					mkdirSync(outdir, { recursive: true });
					copyFileSync(source, join(outdir, name));
				}
				return { path: `./${name}`, external: true };
			});
		}
	};
};

/**
 * Bundles an Elysium app for Cloudflare Workers, with its routes compiled ahead of time by
 * `elysia/plugin/aot`, since workerd forbids generating code at runtime.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class WorkersBuilder {
	/**
	 * Builds the Worker bundle.
	 * @param options The entry, output and bundle options.
	 * @throws When the bundle fails, or still generates code at runtime.
	 */
	public async build(options: WorkersBuildOptions): Promise<WorkersBuildResult> {
		const startTime = Date.now();
		const outfile = options.outfile ?? 'worker.js';
		const { aot } = await import('elysia/plugin/aot/bun');
		stubCloudflareModules();

		const result = await Bun.build({
			entrypoints: [options.entry],
			outdir: options.outdir,
			naming: outfile,
			target: 'browser',
			format: 'esm',
			conditions: ['workerd', 'worker', 'browser'],
			external: ['node:*', 'cloudflare:*'],
			minify: options.minify ?? true,
			sourcemap: (options.sourcemap ?? true) ? 'linked' : 'none',
			plugins: [
				wasmModules(options.outdir),
				browserEntries,
				aot(options.entry, { target: 'workerd' }),
				...(options.plugins ?? [])
			]
		});
		if (!result.success) {
			throw new AggregateError(result.logs, `The Worker bundle of ${options.entry} failed.`);
		}

		const outputPath = join(options.outdir, outfile);
		const bundle = await Bun.file(outputPath).text();
		if (CODEGEN.test(bundle)) {
			throw new Error(
				'The Worker bundle generates code at runtime, which workerd forbids. Export the root Elysia app as `app` from the entry so that its routes compile ahead of time.'
			);
		}

		return {
			outputPath,
			size: Buffer.byteLength(bundle),
			gzipSize: gzipSync(bundle).byteLength,
			duration: Date.now() - startTime
		};
	}
}
