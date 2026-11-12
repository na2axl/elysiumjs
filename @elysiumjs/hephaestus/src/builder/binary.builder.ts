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

import type { HephaestusConfig, PlatformTarget } from '../types';

import { join } from 'node:path';

import { bunTarget, detectCurrentPlatform, getOutputName } from '../platform';

/**
 * Result of a single binary compilation.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export interface BuildResult {
	platform: PlatformTarget;
	outputPath: string;
	size: number;
	duration: number;
}

/**
 * Compiles Elysium projects into single-binary executables using Bun.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class BinaryBuilder {
	constructor(private config: HephaestusConfig) {}

	/**
	 * Builds a single binary for a specific platform, or the current one if not specified.
	 * @author Axel Nana <ax.lnana@outlook.com>
	 * @param platform The target platform. Defaults to the current platform.
	 * @returns The build result with metrics.
	 */
	public async build(platform?: PlatformTarget): Promise<BuildResult> {
		const startTime = Date.now();
		const targetPlatform = platform ?? detectCurrentPlatform();
		const outputName = getOutputName(this.config.output.name, targetPlatform);
		const outputPath = join(this.config.output.dir, outputName);

		const args = ['bun', 'build', this.config.entry, '--compile', '--outfile', outputPath];

		if (this.config.build.minify) args.push('--minify');
		if (this.config.build.sourcemap) args.push('--sourcemap');
		if (platform && platform !== detectCurrentPlatform()) {
			args.push('--target', bunTarget(platform));
		}

		// Use Bun.spawn() array form — no shell interpolation
		const proc = Bun.spawn(args, { stdout: 'pipe', stderr: 'pipe' });
		const exitCode = await proc.exited;

		if (exitCode !== 0) {
			const stderr = await new Response(proc.stderr).text();
			throw new Error(`Build failed for ${targetPlatform}: ${stderr}`);
		}

		// Bun.file().size is a sync property (no .stat() method)
		const size = Bun.file(outputPath).size;

		return {
			platform: targetPlatform,
			outputPath,
			size,
			duration: Date.now() - startTime
		};
	}

	/**
	 * Builds binaries for all configured platforms, or the current one if none are configured.
	 * @author Axel Nana <ax.lnana@outlook.com>
	 * @returns An array of build results.
	 */
	public async buildAll(): Promise<BuildResult[]> {
		const platforms = this.config.platforms;

		if (platforms.length === 0) {
			return [await this.build()];
		}

		const results: BuildResult[] = [];

		for (const platform of platforms) {
			results.push(await this.build(platform));
		}

		return results;
	}
}
