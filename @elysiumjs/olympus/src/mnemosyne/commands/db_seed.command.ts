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

import type { Kernel } from '../../index';

import { Command, CommandArgumentType, KERNEL_SERVICE, Runtime, Service } from '../../index';
import { Seeder } from '../seeder';

/**
 * Runs the seeders of the active modules, in order, each in its own transaction. The app boots
 * lazily: only the services the seeders take are built, so services that need a host (such as
 * the bindings of a Worker) do not stop a seed run.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
@Command.register()
export class DbSeedCommand extends Command {
	public static readonly command: string = 'db:seed';
	public static readonly description: string = 'Runs the seeders of the active modules.';

	@Command.arg({
		description:
			'The seeders to run, by name (manual ones included). Defaults to every non-manual seeder.',
		type: CommandArgumentType.ARRAY,
		arrayType: CommandArgumentType.STRING,
		default: []
	})
	private only: string[] = [];

	@Command.arg({
		description: 'A file for the seeders to read, as this.input.file.',
		type: CommandArgumentType.STRING
	})
	private file?: string;

	@Command.arg({
		description: 'key=value pairs for the seeders, as this.input.args.',
		type: CommandArgumentType.ARRAY,
		arrayType: CommandArgumentType.STRING,
		default: []
	})
	private arg: string[] = [];

	@Command.arg({
		description: 'Lists the seeders that would run, in order, without running them.',
		type: CommandArgumentType.BOOLEAN,
		default: false
	})
	private list: boolean = false;

	public async run(): Promise<void> {
		const args: Record<string, string> = {};
		for (const pair of this.arg) {
			const at = pair.indexOf('=');
			if (at < 1) {
				this.error(`Invalid --arg ${this.bold(pair)}: use key=value.`);
				return Runtime.get().exit(1);
			}
			args[pair.slice(0, at)] = pair.slice(at + 1);
		}

		const kernel = Service.get<Kernel>(KERNEL_SERVICE)!;
		const planned = Seeder.plan(kernel.graph, this.only);
		if (planned.length === 0) {
			this.info('No seeder to run.');
			return;
		}

		if (this.list) {
			for (const { name, manual } of planned) this.write(`${name}${manual ? ' (manual)' : ''}`);
			return;
		}

		for (const seeder of planned) {
			const started = performance.now();
			await Seeder.execute(seeder, { file: this.file, args });
			this.success(
				`Seeder ${this.bold(seeder.name)} done in ${Math.round(performance.now() - started)} ms.`
			);
		}
	}
}
