// Copyright (c) 2025-present Axel Nana <ax.lnana@outlook.com>. All rights reserved.
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

import type { ModuleClass } from '@elysiumjs/olympus';

import { Application, Module } from '@elysiumjs/olympus';
import { runtime as bunRuntime } from '@elysiumjs/runtime-bun';

import {
	MakeCommandCommand,
	MakeControllerCommand,
	MakeJobCommand,
	MakeMiddlewareCommand,
	MakeModelCommand,
	MakeRepositoryCommand,
	MakeSeederCommand,
	MakeServiceCommand,
	MakeValidatorCommand,
	ModuleNewCommand,
	ModuleRenameCommand,
	RoutesCheckCommand,
	RoutesGenerateCommand
} from '../commands';
import { CreateCommand } from '../create/create.command';

/**
 * The commands Styx runs itself: `create`, the code generators, `routes:check` and `routes:generate`.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
@Module.register({
	commands: [
		CreateCommand,
		MakeCommandCommand,
		MakeControllerCommand,
		MakeJobCommand,
		MakeMiddlewareCommand,
		MakeModelCommand,
		MakeRepositoryCommand,
		MakeSeederCommand,
		MakeServiceCommand,
		MakeValidatorCommand,
		ModuleNewCommand,
		ModuleRenameCommand,
		RoutesCheckCommand,
		RoutesGenerateCommand
	]
})
export class StyxCliModule extends Module {}

/**
 * Runs a command of the global `styx` CLI, without loading any project.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @param argv The command and its arguments.
 * @param tools Modules of build tools found in the project (such as Hephaestus).
 */
export const runCli = async (argv: string[], tools: ModuleClass[] = []): Promise<void> => {
	@Application.register({ runtime: bunRuntime, modules: [StyxCliModule, ...tools], openapi: false })
	class StyxCli extends Application {}

	await new StyxCli().run(argv);
};
