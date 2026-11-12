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

import { Module } from '@elysiumjs/olympus';

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
	ModuleRenameCommand
} from './commands';

/**
 * The development-only module holding the `make:*` and `module:*` scaffolding commands.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
@Module.register({
	env: ['development'],
	commands: [
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
		ModuleRenameCommand
	]
})
export class StyxModule extends Module {}
