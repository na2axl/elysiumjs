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

import { Command, CommandArgumentType } from '@elysiumjs/core';

import { loadConfig } from '../config/loader';
import { DockerGenerator } from './docker.generator';

/**
 * Command used to generate a Dockerfile for the compiled binary.
 * @author Axel Nana <axel.nana@workbud.com>
 */
@Command.register()
export class HephaestusDockerCommand extends Command {
	public static readonly command: string = 'hephaestus:docker';
	public static readonly description: string = 'Generate a Dockerfile for the compiled binary.';

	@Command.arg({
		name: 'output',
		required: false,
		description: 'Output directory for the Dockerfile',
		type: CommandArgumentType.STRING,
		default: '.'
	})
	private output: string = '.';

	public async run(): Promise<void> {
		try {
			const config = await loadConfig();
			const generator = new DockerGenerator(config);

			generator.generate(this.output);

			this.success(`Dockerfile generated in ${this.output}`);
		} catch (error: any) {
			this.trace(error, 'Dockerfile generation failed');
			process.exit(1);
		}
	}
}
