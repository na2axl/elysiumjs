// Copyright (c) 2025-present Workbud Technologies Inc. All rights reserved.
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

/**
 * What the `styx` command does with its arguments.
 * - `version`: print the version.
 * - `cli`: run Styx's own commands (`create`, the code generators) without loading a project.
 * - `handoff`: run the project's own Styx, like nest-cli does, so the project's versions are used.
 * - `app`: load the project's app and run the command there (`serve`, the app's commands).
 * - `error`: say why the command cannot run here.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type Route =
	| { kind: 'version' }
	| { kind: 'cli'; argv: string[] }
	| { kind: 'handoff'; cli: string; argv: string[] }
	| { kind: 'app'; project: string; argv: string[] }
	| { kind: 'error'; message: string };

/** Where the `styx` command runs. */
export type RouteContext = {
	/** The project folder (holding `.elysiumrc`), when inside one. */
	project?: string;
	/** The entry of the project's own Styx, when the project installs it. */
	projectCli?: string;
	/** The entry of the running Styx. */
	self: string;
};

/** Commands that never need a project. */
const GLOBAL_COMMANDS = new Set(['create', 'new']);

/** Code generators: they write files and never load the app. */
export const isGenerator = (command: string | undefined): boolean =>
	command !== undefined && /^(make|module):/.test(command);

/** Commands Styx runs itself inside a project: the code generators and the build tools. */
export const isCliCommand = (command: string | undefined): boolean =>
	isGenerator(command) || (command !== undefined && /^hephaestus:/.test(command));

/** Turns `create my-app` into `create --name my-app`. */
const withPositionalName = (argv: string[]): string[] => {
	const [, name, ...rest] = argv;
	if (name === undefined || name.startsWith('--')) return ['create', ...argv.slice(1)];
	return ['create', '--name', name, ...rest];
};

/**
 * Decides what `styx` does with its arguments.
 * @author Axel Nana <axel.nana@workbud.com>
 * @param argv The arguments, without the executable and script.
 * @param context Where the command runs.
 */
export const route = (argv: string[], context: RouteContext): Route => {
	const [command] = argv;

	if (command === '--version' || command === '-v' || command === 'version')
		return { kind: 'version' };
	if (command !== undefined && GLOBAL_COMMANDS.has(command)) {
		return { kind: 'cli', argv: withPositionalName(argv) };
	}

	if (!context.project) {
		if (command === undefined || command === 'list' || command === 'help' || isGenerator(command)) {
			return isGenerator(command)
				? {
						kind: 'error',
						message: `Run ${command} inside an Elysium project (a folder with an .elysiumrc file).`
					}
				: { kind: 'cli', argv };
		}
		return {
			kind: 'error',
			message: `Not inside an Elysium project (no .elysiumrc found). Create one with: styx create my-app`
		};
	}

	if (context.projectCli && context.projectCli !== context.self) {
		return { kind: 'handoff', cli: context.projectCli, argv };
	}

	if (isCliCommand(command)) return { kind: 'cli', argv };

	if (!context.projectCli) {
		return {
			kind: 'error',
			message:
				'This project does not install @elysiumjs/styx. Add it with: bun add -D @elysiumjs/styx'
		};
	}

	return { kind: 'app', project: context.project, argv };
};
