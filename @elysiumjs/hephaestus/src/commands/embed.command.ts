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

import { join } from 'node:path';

import { Command } from '@elysiumjs/olympus';

import { AssetEmbedder } from '../assets/embedder';
import { loadConfig } from '../config/loader';

/**
 * Command used to generate asset loader module from configured patterns.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
@Command.register()
export class HephaestusEmbedCommand extends Command {
	public static readonly command: string = 'hephaestus:embed';
	public static readonly description: string =
		'Generate asset loader module from configured patterns.';

	public async run(): Promise<void> {
		try {
			const spinner = this.spinner('Scanning and embedding assets');

			const config = await loadConfig();
			const embedder = new AssetEmbedder(config);
			const loader = await embedder.embed();
			const outputPath = join(config.output.dir, '__assets__.ts');

			await Bun.write(outputPath, loader);

			spinner.complete('Assets embedded successfully');
			this.newLine();
			this.success(`Asset loader generated: ${outputPath}`);
		} catch (error: any) {
			this.trace(error, 'Asset embedding failed');
			process.exit(1);
		}
	}
}
