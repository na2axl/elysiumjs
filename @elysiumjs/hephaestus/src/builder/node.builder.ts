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

import type { BunPlugin } from 'bun';

import { join } from 'node:path';

/**
 * Options of {@link NodeBuilder.build}.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export interface NodeBuildOptions {
	/** The server entry: it builds the app with the Node.js runtime and serves it. */
	entry: string;
	/** The output folder. */
	outdir: string;
	/** The output file name. Defaults to `server.js`. */
	outfile?: string;
	/** Packages left out of the bundle and loaded from `node_modules` at runtime. */
	external?: string[];
	/** Whether to minify the bundle. Defaults to `true`. */
	minify?: boolean;
	/** Whether to write a linked source map. Defaults to `true`. */
	sourcemap?: boolean;
	/** Bun plugins added to the build. */
	plugins?: BunPlugin[];
}

/**
 * Result of a Node.js build.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export interface NodeBuildResult {
	outputPath: string;
	size: number;
	duration: number;
}

/**
 * Bundles an Elysium app into one ES module for Node.js. The bundler emits the decorator
 * metadata the container reads (`emitDecoratorMetadata` in tsconfig), so the app needs no `tsc`
 * step; run the output with `node`.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class NodeBuilder {
	/**
	 * Builds the server bundle.
	 * @param options The entry, output and bundle options.
	 * @throws When the bundle fails.
	 */
	public async build(options: NodeBuildOptions): Promise<NodeBuildResult> {
		const startTime = Date.now();
		const outfile = options.outfile ?? 'server.js';

		const result = await Bun.build({
			entrypoints: [options.entry],
			outdir: options.outdir,
			naming: outfile,
			target: 'node',
			format: 'esm',
			conditions: ['node'],
			external: options.external ?? [],
			minify: options.minify ?? true,
			sourcemap: (options.sourcemap ?? true) ? 'linked' : 'none',
			plugins: options.plugins ?? []
		});
		if (!result.success) {
			throw new AggregateError(result.logs, `The Node.js bundle of ${options.entry} failed.`);
		}

		const outputPath = join(options.outdir, outfile);
		return {
			outputPath,
			size: Bun.file(outputPath).size,
			duration: Date.now() - startTime
		};
	}
}
