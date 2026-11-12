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

import type { HephaestusConfig } from '../types';

import { basename, join } from 'node:path';

import { HephaestusConfigSchema } from '../types';

const CONFIG_FILENAMES = ['hephaestus.config.ts', 'hephaestus.config.js', 'hephaestus.config.json'];

/**
 * Loads and validates the Hephaestus build configuration from the project root.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @param cwd The working directory to search for config files.
 * @param options With `optional`, a project without a config gets the defaults, named after its
 * folder.
 * @returns The validated configuration.
 */
export async function loadConfig(
	cwd: string = process.cwd(),
	options: { optional?: boolean } = {}
): Promise<HephaestusConfig> {
	for (const filename of CONFIG_FILENAMES) {
		const configPath = join(cwd, filename);
		const file = Bun.file(configPath);

		if (await file.exists()) {
			if (filename.endsWith('.json')) {
				const raw = await file.json();
				return HephaestusConfigSchema.parse(raw);
			}

			const mod = await import(configPath);
			return HephaestusConfigSchema.parse(mod.default ?? mod);
		}
	}

	if (options.optional) return HephaestusConfigSchema.parse({ output: { name: basename(cwd) } });

	throw new Error(`No Hephaestus config found. Create one of: ${CONFIG_FILENAMES.join(', ')}`);
}
