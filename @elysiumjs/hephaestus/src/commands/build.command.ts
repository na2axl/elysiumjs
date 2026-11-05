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

import type { PlatformTarget } from '../types';

import { Command, CommandArgumentType } from '@elysiumjs/core';

import { BinaryBuilder } from '../builder/binary.builder';
import { WorkersBuilder } from '../builder/workers.builder';
import { loadConfig } from '../config/loader';

/**
 * Command used to build the project into a standalone binary (`--target binary`, the default) or
 * a Cloudflare Worker bundle compiled ahead of time (`--target workers`).
 * @author Axel Nana <axel.nana@workbud.com>
 */
@Command.register()
export class HephaestusBuildCommand extends Command {
	public static readonly command: string = 'hephaestus:build';
	public static readonly description: string =
		'Build the project into a standalone binary, or a Cloudflare Worker bundle.';
	public static override readonly dev: boolean = true;

	@Command.arg({
		name: 'target',
		required: false,
		description: 'What to build: a standalone binary, or a Cloudflare Worker bundle',
		type: CommandArgumentType.ENUM,
		enum: ['binary', 'workers'],
		default: 'binary'
	})
	private target: 'binary' | 'workers' = 'binary';

	@Command.arg({
		name: 'entry',
		required: false,
		description: 'The entry to build, instead of the one in the config'
	})
	private entry?: string;

	@Command.arg({
		name: 'platform',
		required: false,
		description: 'Target platform for the build',
		type: CommandArgumentType.ENUM,
		enum: [
			'linux-x64',
			'linux-x64-baseline',
			'linux-arm64',
			'darwin-x64',
			'darwin-arm64',
			'windows-x64'
		]
	})
	private platform?: PlatformTarget;

	@Command.arg({
		name: 'all-platforms',
		required: false,
		description: 'Build for all configured platforms',
		type: CommandArgumentType.BOOLEAN,
		default: false
	})
	private allPlatforms: boolean = false;

	public async run(): Promise<void> {
		if (this.target === 'workers') return this.buildWorker();

		try {
			const config = await loadConfig();
			if (this.entry) config.entry = this.entry;
			const builder = new BinaryBuilder(config);

			if (this.allPlatforms) {
				const spinner = this.spinner('Building for all platforms');
				const results = await builder.buildAll();
				spinner.complete('Build completed');

				this.newLine();
				this.title('Build Results:');
				for (const result of results) {
					this.info(
						`${result.platform}: ${result.outputPath} (${this.formatSize(result.size)}, ${result.duration}ms)`
					);
				}
			} else {
				const targetPlatform = this.platform;
				const platformText = targetPlatform ? ` for ${targetPlatform}` : '';
				const spinner = this.spinner(`Building${platformText}`);

				const result = await builder.build(targetPlatform);
				spinner.complete('Build completed');

				this.newLine();
				this.success(
					`Built ${result.platform}: ${result.outputPath} (${this.formatSize(result.size)}, ${result.duration}ms)`
				);
			}
		} catch (error: any) {
			this.trace(error, 'Build failed');
			process.exit(1);
		}
	}

	/** Builds the Worker bundle, compiled ahead of time for workerd. */
	private async buildWorker(): Promise<void> {
		try {
			const config = await loadConfig(process.cwd(), { optional: true });
			const spinner = this.spinner('Building the Worker');
			const result = await new WorkersBuilder().build({
				entry: this.entry ?? config.workers.entry,
				outdir: config.output.dir,
				outfile: config.workers.outfile,
				minify: config.build.minify,
				sourcemap: config.build.sourcemap
			});
			spinner.complete('Build completed');

			this.newLine();
			this.success(
				`Built ${result.outputPath} (${this.formatSize(result.size)}, ${this.formatSize(result.gzipSize)} gzipped, ${result.duration}ms)`
			);
		} catch (error: any) {
			this.trace(error, 'Build failed');
			process.exit(1);
		}
	}

	private formatSize(bytes: number): string {
		if (bytes < 1024) return `${bytes}B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
	}
}
