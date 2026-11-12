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

import { Command, CommandArgumentType, ConsoleFormat } from '@elysiumjs/core';

import { Projection } from '../projection';

/**
 * Rebuilds the projections whose version changed, or the one named with `--name`.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
@Command.register()
export class ProjectionRebuildCommand extends Command {
	public static readonly command: string = 'projection:rebuild';
	public static readonly description: string =
		'Rebuild the projections whose version changed, or the one given by --name.';
	public static readonly boot = true;

	@Command.arg({
		name: 'name',
		required: false,
		description: 'The name of the projection to rebuild, whatever its version',
		type: CommandArgumentType.STRING
	})
	private name?: string;

	public async run(): Promise<void> {
		const names = this.name ? [this.name] : await Projection.stale();
		if (names.length === 0) {
			this.write('Every projection is up to date.');
			return;
		}
		for (const name of names) {
			const replayed = await Projection.rebuild(name);
			this.write(`${this.format(name, ConsoleFormat.CYAN)} rebuilt from ${replayed} events.`);
		}
	}
}
