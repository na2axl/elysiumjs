#!/usr/bin/env bun
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

/**
 * The `styx` command. Installed globally (`bun add -g @elysiumjs/styx`) or in a project.
 */
import type { ModuleClass } from '@elysiumjs/core';

import { existsSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { route } from './cli/route';

/** Finds the project folder: the closest one holding `.elysiumrc`. */
const findProject = (from: string): string | undefined => {
	for (let dir = from; ; dir = dirname(dir)) {
		if (existsSync(join(dir, '.elysiumrc'))) return dir;
		if (dirname(dir) === dir) return undefined;
	}
};

/** Resolves a package path the way the project would import it (works in workspaces). */
const resolveFrom = (project: string, specifier: string): string | undefined => {
	try {
		return Bun.resolveSync(specifier, project);
	} catch {
		return undefined;
	}
};

const real = (path: string): string => {
	try {
		return realpathSync(path);
	} catch {
		return path;
	}
};

/** The entry of the Styx a project installs, when it does. */
const findProjectCli = (project: string): string | undefined => {
	const cli = resolveFrom(project, '@elysiumjs/styx/dist/cli.js');
	return cli ? real(cli) : undefined;
};

/**
 * Loads the build tool modules a project installs. Only the project's own Styx loads them: it
 * shares the project's \`@elysiumjs/core\`, which the tools register their commands with.
 */
const loadTools = async (
	project: string | undefined,
	isProjectCli: boolean
): Promise<ModuleClass[]> => {
	if (!project || !isProjectCli) return [];
	const entry = resolveFrom(project, '@elysiumjs/hephaestus');
	if (!entry) return [];
	const hephaestus = await import(entry);
	return hephaestus.HephaestusModule ? [hephaestus.HephaestusModule] : [];
};

/** Whether the command lists or describes commands: `styx`, `styx list`, `styx help <command>`. */
const listsCommands = ([command]: string[]): boolean =>
	command === undefined || command === 'list' || command === 'help';

const argv = process.argv.slice(2);
const project = findProject(process.cwd());
const projectCli = project ? findProjectCli(project) : undefined;
const self = real(Bun.main);
const decision = route(argv, { project, projectCli, self });

switch (decision.kind) {
	case 'version': {
		const { version } = await import('../package.json');
		console.log(version);
		break;
	}
	case 'error':
		console.error(decision.message);
		process.exit(1);
	case 'handoff': {
		const bun = Bun.which('bun');
		if (!bun) {
			console.error('Bun is needed to run the Styx installed in this project: https://bun.sh');
			process.exit(1);
		}
		const proc = Bun.spawn([bun, decision.cli, ...decision.argv], {
			stdio: ['inherit', 'inherit', 'inherit']
		});
		process.exit(await proc.exited);
	}
	case 'cli': {
		const { stubCloudflareModules } = await import('./cloudflare-stubs');
		stubCloudflareModules();
		const { runCli } = await import('./cli/app');
		await runCli(decision.argv, await loadTools(project, projectCli === self));
		break;
	}
	case 'app': {
		const { stubCloudflareModules } = await import('./cloudflare-stubs');
		stubCloudflareModules();
		const { resolveAppEntry } = await import('./utils');
		const { Application, ElysiumError } = await import('@elysiumjs/core');
		try {
			let App = await resolveAppEntry(decision.project);
			if (listsCommands(decision.argv)) {
				// The listing and the help show Styx's commands beside the app's.
				const { StyxCliModule } = await import('./cli/app');
				const modules = [StyxCliModule, ...(await loadTools(project, true))];
				@Application.register({ modules })
				class AppWithStyx extends App {}
				App = AppWithStyx;
			}
			await new (App as unknown as new () => { run(argv: string[]): Promise<void> })().run(
				decision.argv
			);
		} catch (error) {
			if (!(error instanceof ElysiumError)) throw error;
			console.error(error.message);
			process.exit(1);
		}
		break;
	}
}
