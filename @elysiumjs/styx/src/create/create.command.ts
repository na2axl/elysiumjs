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

import type { PromptObject } from 'prompts';
import type { EnabledModule } from './code';

import { existsSync } from 'node:fs';
import { mkdir, readdir, rm } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';

import { Command, CommandArgumentType, ConsoleFormat } from '@elysiumjs/core';
import prompts from 'prompts';
import { assign, objectify, pascal } from 'radash';

import { listAssets, readAsset } from '../assets';
import { fileName } from '../utils';
import {
	appPackages,
	getAppCode,
	getEnvCode,
	getModuleCode,
	getScripts,
	getWorkerCode,
	getWranglerConfig,
	RUNTIMES,
	versionFor
} from './code';
import { resolveProjectPath, validateModuleName, validateProjectName } from './names';

/** The package managers `styx create` can install with. */
export const PACKAGE_MANAGERS = ['bun', 'npm', 'pnpm'] as const;

/** A package manager `styx create` can install with. */
export type PackageManager = (typeof PACKAGE_MANAGERS)[number];

/** How a package manager runs a script: `bun run`, `npm run`, `pnpm run`. */
const runWith = (manager: PackageManager) => `${manager} run`;

/** The answers that describe the project to create. */
export type CreateOptions = {
	name: string;
	path: string;
	template: 'single' | 'multi';
	runtime: keyof typeof RUNTIMES;
	/** Whether to set up a PostgreSQL connection. */
	database: boolean;
	/** Whether to set up a Redis connection. */
	cache: boolean;
	/** The package manager that installs the dependencies and runs the scripts. */
	packageManager: PackageManager;
	modules: string[];
	plugins: string[];
	features: string[];
	git: boolean;
	install: boolean;
	force: boolean;
};

/** Splits a comma separated list. */
const list = (value: unknown): string[] | undefined =>
	typeof value === 'string'
		? value
				.split(',')
				.map((item) => item.trim())
				.filter(Boolean)
		: undefined;

/**
 * Copies a folder of the styx assets into a project, replacing `{PROJECT_NAME}`.
 * Empty folders are kept through their `.gitkeep`, which is not copied.
 */
const copyAssets = async (folder: string, to: string, projectName: string, skip: string[] = []) => {
	for (const path of await listAssets(folder)) {
		const target = join(to, path);
		await mkdir(dirname(target), { recursive: true });
		const file = path.split('/').at(-1)!;
		if (file === '.gitkeep' || skip.includes(file)) continue;
		const text = await readAsset(`${folder}/${path}`);
		// npm drops `.gitignore` from published packages, so it ships as `gitignore`.
		const renamed = file === 'gitignore' ? join(dirname(target), '.gitignore') : target;
		await Bun.write(renamed, text.replaceAll('{PROJECT_NAME}', projectName));
	}
};

/**
 * Writes a new Elysium project. Installing dependencies and running git are left to `run`.
 * @author Axel Nana <axel.nana@workbud.com>
 * @param options The project to create.
 * @param exec Runs a shell command in the project folder.
 * @param progress Reports the current step.
 * @returns The folder of the new project.
 */
export const createProject = async (
	options: CreateOptions,
	exec: (cwd: string, command: string[]) => Promise<void>,
	progress: (step: string) => void = () => {}
): Promise<string> => {
	// Checked first: the project path may be removed below, with --force.
	const directory = validateProjectName(options.name);
	const projectPath = resolveProjectPath(options.path, directory);
	const modules =
		options.template === 'single' ? ['main'] : options.modules.map(validateModuleName);

	if (!RUNTIMES[options.runtime]) throw new Error(`Unknown runtime ${options.runtime}.`);
	if (!PACKAGE_MANAGERS.includes(options.packageManager)) {
		throw new Error(`Unknown package manager ${options.packageManager}.`);
	}
	const parts = { database: options.database, cache: options.cache };
	if ((await listAssets(`templates/template-${options.template}`)).length === 0) {
		throw new Error(`Unknown template ${options.template}.`);
	}

	progress('Creating project directory...');
	if (existsSync(projectPath) && (await readdir(projectPath)).length > 0) {
		if (!options.force) throw new Error(`${projectPath} already exists and is not empty.`);
		await rm(projectPath, { recursive: true, force: true });
	}
	await mkdir(projectPath, { recursive: true });

	progress('Copying template files...');
	await copyAssets(`templates/template-${options.template}`, projectPath, options.name);
	await writeRuntimeFiles(projectPath, options);

	await Bun.write(
		join(projectPath, '.elysiumrc'),
		JSON.stringify(
			{
				projectName: options.name,
				mono: options.template !== 'multi',
				modules:
					options.template === 'multi'
						? objectify(
								modules,
								(m) => m,
								(m) => `src/modules/${m}`
							)
						: undefined
			},
			null,
			2
		)
	);

	for (const module of modules) {
		const modulePath =
			options.template === 'multi'
				? join(projectPath, 'src', 'modules', module)
				: join(projectPath, 'src');
		await copyAssets('templates/shared-module', modulePath, options.name);
		await Bun.write(
			join(modulePath, `${fileName(module)}.module.ts`),
			getModuleCode(pascal(module))
		);
	}

	const packageFile = join(projectPath, 'package.json');
	let packageJson = assign(await Bun.file(packageFile).json(), {
		scripts: getScripts(options.runtime),
		imports:
			options.template === 'multi'
				? objectify(
						modules,
						(m) => `#${m}/*`,
						(m) => `./src/modules/${m}/*.ts`
					)
				: { '#root/*': './src/*.ts' }
	});

	const base = appPackages(options.runtime, parts);
	const devPackages: string[] = [...base.dev];
	const packages: string[] = [...base.prod];
	const enabledModules: EnabledModule[] = [];

	for (const [kind, names] of [
		['plugin', options.plugins],
		['feature', options.features]
	] as const) {
		for (const name of names) {
			const folder = `templates/${kind}-${name}`;
			if ((await listAssets(folder)).length === 0) throw new Error(`Unknown ${kind} ${name}.`);
			await copyAssets(folder, projectPath, options.name, ['.specs']);
			const specs = JSON.parse(await readAsset(`${folder}/.specs`));
			devPackages.push(...(specs.packages?.dev ?? []));
			packages.push(...(specs.packages?.prod ?? []));
			if (specs.patch) packageJson = assign(packageJson, specs.patch);
			if (specs.module) enabledModules.push(specs.module as EnabledModule);
		}
	}

	const declare = (names: string[]) => objectify(names, (n) => n, versionFor);
	packageJson = assign(packageJson, {
		dependencies: { ...packageJson.dependencies, ...declare(packages) },
		devDependencies: { ...packageJson.devDependencies, ...declare(devPackages) }
	});
	await Bun.write(packageFile, JSON.stringify(packageJson, null, 2) + '\n');

	await Bun.write(join(projectPath, 'src', 'env.ts'), getEnvCode(options.runtime, parts));
	await Bun.write(
		join(projectPath, 'src', 'app.ts'),
		getAppCode(
			options.name,
			objectify(
				modules,
				(m) => m,
				(m) =>
					options.template === 'multi'
						? `#${m}/${fileName(m)}.module`
						: `#root/${fileName(m)}.module`
			),
			enabledModules,
			options.runtime,
			parts
		)
	);

	if (options.install) {
		progress('Installing dependencies...');
		await exec(projectPath, [options.packageManager, 'install']);
		if (options.features.includes('prettier')) {
			progress('Formatting code using Prettier...');
			await exec(projectPath, [options.packageManager, 'run', 'format']);
		}
	}

	if (options.git) {
		progress('Initializing Git repository...');
		await exec(projectPath, ['git', 'init']);
	}

	return projectPath;
};

/**
 * Writes what differs between runtimes: the tsconfig types, the README commands, and for
 * Cloudflare Workers the Worker entry and the wrangler config in place of `index.ts`.
 */
const writeRuntimeFiles = async (projectPath: string, options: CreateOptions): Promise<void> => {
	const tsconfigFile = join(projectPath, 'tsconfig.json');
	const tsconfig = await Bun.file(tsconfigFile).text();
	const types = JSON.stringify(RUNTIMES[options.runtime].types);
	await Bun.write(tsconfigFile, tsconfig.replace(/"types":\s*\[[^\]]*\]/, `"types": ${types}`));

	const readmeFile = join(projectPath, 'README.md');
	const readme = await Bun.file(readmeFile).text();
	await Bun.write(
		readmeFile,
		readme
			.replaceAll('{INSTALL}', `${options.packageManager} install`)
			.replaceAll('{RUN}', runWith(options.packageManager))
	);

	if (options.runtime === 'workers') {
		await rm(join(projectPath, 'index.ts'), { force: true });
		await mkdir(join(projectPath, 'src'), { recursive: true });
		await Bun.write(join(projectPath, 'src', 'worker.ts'), getWorkerCode());
		await Bun.write(
			join(projectPath, 'wrangler.jsonc'),
			getWranglerConfig(options.name, { database: options.database, cache: options.cache })
		);
	}
};

/** Runs a command in a folder, failing with its output when it fails. */
const execIn = async (cwd: string, command: string[]): Promise<void> => {
	const proc = Bun.spawn(command, { cwd, stdout: 'pipe', stderr: 'pipe' });
	if ((await proc.exited) !== 0) {
		throw new Error(`${command.join(' ')} failed: ${await new Response(proc.stderr).text()}`);
	}
};

/**
 * Creates a new Elysium project: `styx create my-app`. Asks for what the arguments leave out.
 * @author Axel Nana <axel.nana@workbud.com>
 */
@Command.register()
export class CreateCommand extends Command {
	public static override readonly command: string = 'create';
	public static override readonly description: string = 'Creates a new Elysium project.';

	@Command.arg({ description: 'The name of the project', type: CommandArgumentType.STRING })
	private name?: string;

	@Command.arg({ description: 'Where to create the project', type: CommandArgumentType.STRING })
	private path?: string;

	@Command.arg({ description: 'The template: single or multi', type: CommandArgumentType.STRING })
	private template?: string;

	@Command.arg({
		description: 'The runtime: bun, node or workers',
		type: CommandArgumentType.STRING
	})
	private runtime?: string;

	@Command.arg({
		description: 'Set up a PostgreSQL connection',
		type: CommandArgumentType.BOOLEAN
	})
	private database?: boolean;

	@Command.arg({
		description: 'Set up a Redis connection',
		type: CommandArgumentType.BOOLEAN
	})
	private cache?: boolean;

	@Command.arg({
		name: 'package-manager',
		description: 'The package manager: bun, npm or pnpm',
		type: CommandArgumentType.STRING
	})
	private packageManager?: string;

	@Command.arg({
		description: 'The modules of a multi template, comma separated',
		type: CommandArgumentType.STRING
	})
	private modules?: string;

	@Command.arg({
		description: 'The plugins to add, comma separated (sentry)',
		type: CommandArgumentType.STRING
	})
	private plugins?: string;

	@Command.arg({
		description: 'The features to add, comma separated (prettier, hephaestus)',
		type: CommandArgumentType.STRING
	})
	private features?: string;

	@Command.arg({ description: 'Initialize a Git repository', type: CommandArgumentType.BOOLEAN })
	private git?: boolean;

	@Command.arg({
		description: 'Install the dependencies',
		type: CommandArgumentType.BOOLEAN,
		default: true
	})
	private install?: boolean;

	@Command.arg({
		description: 'Replace a folder that is not empty',
		type: CommandArgumentType.BOOLEAN,
		default: false
	})
	private force?: boolean;

	@Command.arg({
		description: 'Use the defaults instead of asking',
		type: CommandArgumentType.BOOLEAN,
		default: false
	})
	private yes?: boolean;

	public async run(): Promise<void> {
		this.write(
			`Welcome to ${this.format('Elysium', ConsoleFormat.MAGENTA, ConsoleFormat.UNDERLINE)}`
		);
		this.newLine();

		const options = await this.ask();

		// The spinner redraws its line, which only a terminal can do.
		const s = process.stdout.isTTY
			? this.spinner('Creating project...')
			: {
					update: (step: string) => this.info(step),
					complete: (message: string) => this.success(message),
					fail: (message: string) => this.error(message)
				};
		try {
			const projectPath = await createProject(options, execIn, (step) => s.update(step));
			s.complete(`Project ${options.name} created successfully`);
			const dev = `${runWith(options.packageManager)} dev`;
			this.info(
				`Open it with ${this.format(`cd ${relative(process.cwd(), projectPath)}`, ConsoleFormat.BLUE, ConsoleFormat.BOLD)}, then run ${this.format(dev, ConsoleFormat.BLUE, ConsoleFormat.BOLD)}`
			);
		} catch (error) {
			s.fail(error instanceof Error ? error.message : String(error));
			process.exitCode = 1;
		}
	}

	/** Builds the options from the arguments, asking for what they leave out. */
	private async ask(): Promise<CreateOptions> {
		const interactive = !this.yes && process.stdin.isTTY === true;
		const given = {
			name: this.name,
			path: this.path,
			template: this.template,
			runtime: this.runtime,
			database: this.database,
			cache: this.cache,
			packageManager: this.packageManager,
			modules: list(this.modules),
			plugins: list(this.plugins),
			features: list(this.features),
			git: this.git
		};

		const questions: PromptObject[] = [
			{
				type: given.name ? null : 'text',
				name: 'name',
				message: 'What is the name of the project?',
				initial: 'elysium-app',
				validate: (value: string) => {
					try {
						validateProjectName(value);
						return true;
					} catch (error) {
						return (error as Error).message;
					}
				}
			},
			{
				type: given.template ? null : 'select',
				name: 'template',
				message: 'Which template would you like to use?',
				choices: [
					{ title: 'Single Module', value: 'single', description: 'A single module project' },
					{
						title: 'Multi Module',
						value: 'multi',
						description: 'A project with several modules (monolith)'
					}
				]
			},
			{
				type: given.runtime ? null : 'select',
				name: 'runtime',
				message: 'Which runtime will the app run on?',
				choices: Object.entries(RUNTIMES).map(([value, runtime]) => ({
					title: runtime.title,
					value,
					description: runtime.description
				}))
			},
			{
				type: given.database === undefined ? 'confirm' : null,
				name: 'database',
				message: 'Set up a PostgreSQL database?',
				initial: true
			},
			{
				type: given.cache === undefined ? 'confirm' : null,
				name: 'cache',
				message: 'Set up a Redis cache?',
				initial: false
			},
			{
				type: given.packageManager ? null : 'select',
				name: 'packageManager',
				message: 'Which package manager will install the dependencies?',
				choices: PACKAGE_MANAGERS.map((manager) => ({ title: manager, value: manager })),
				initial: (_: unknown, values: { runtime?: string }) =>
					(given.runtime ?? values.runtime ?? 'bun') === 'bun' ? 0 : 1
			},
			{
				type: (_, values) =>
					given.modules || (given.template ?? values.template) !== 'multi' ? null : 'list',
				name: 'modules',
				message: 'Which modules would you like to include? (separate by commas)',
				initial: 'main',
				separator: ','
			},
			{
				type: given.plugins ? null : 'multiselect',
				name: 'plugins',
				message: 'Which plugins would you like to include?',
				choices: [
					{ title: 'Sentry', value: 'sentry', description: 'Error reporting (https://sentry.io)' }
				]
			},
			{
				type: given.features ? null : 'multiselect',
				name: 'features',
				message: 'Select features:',
				choices: [
					{ title: 'Prettier', value: 'prettier', description: 'Format code with Prettier' },
					{
						title: 'Hephaestus',
						value: 'hephaestus',
						description: 'Build standalone executables and Docker images'
					}
				]
			},
			{
				type: given.git === undefined ? 'confirm' : null,
				name: 'git',
				message: 'Initialize a Git repository?',
				initial: true
			}
		];

		const answers = interactive
			? await prompts(questions, {
					onCancel: () => {
						this.error('Project creation cancelled.');
						process.exit(1);
					}
				})
			: {};

		const runtime = (given.runtime ?? answers.runtime ?? 'bun') as CreateOptions['runtime'];
		const name = given.name ?? answers.name;
		if (!name) throw new Error('Give the project a name: styx create my-app');
		validateProjectName(name);

		return {
			name,
			path: given.path ?? '.',
			template: (given.template ?? answers.template ?? 'single') as CreateOptions['template'],
			runtime,
			database: given.database ?? answers.database ?? true,
			cache: given.cache ?? answers.cache ?? false,
			packageManager: (given.packageManager ??
				answers.packageManager ??
				(runtime === 'bun' ? 'bun' : 'npm')) as PackageManager,
			modules: given.modules ?? answers.modules ?? ['main'],
			plugins: given.plugins ?? answers.plugins ?? [],
			features: given.features ?? answers.features ?? [],
			git: given.git ?? answers.git ?? false,
			install: this.install ?? true,
			force: this.force ?? false
		};
	}
}
