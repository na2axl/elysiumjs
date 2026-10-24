#!/usr/bin/env bun

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
import { cp, exists, mkdir, rm } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { cwd } from 'node:process';

import { Command, ConsoleFormat } from '@elysiumjs/core';
import prompts from 'prompts';
import { assign, objectify, pascal, snake } from 'radash';

import type { EnabledModule } from './utils';

import { getAppCode, getModuleCode } from './utils';

const __dirname = dirname(Bun.fileURLToPath(import.meta.url));

class CreateElysiumCommand extends Command {
	public static override readonly command: string = 'create-elysium';
	public static override readonly description: string = 'Bootstrap a new Elysium.js app';
	public static override readonly dev: boolean = false;

	public async run(): Promise<void> {
		this.write(
			`Welcome to ${this.format('Elysium', ConsoleFormat.MAGENTA, ConsoleFormat.UNDERLINE)}`
		);
		this.write('This tool will help you create a new Elysium project.');
		this.newLine();

		const answers = await prompts(
			[
				{
					type: 'text',
					name: 'project_name',
					message: 'What is the name of the project?',
					initial: 'elysiumjs-project',
					validate(value: string) {
						if (!/^[a-z0-9\@\-\_\/]+$/gi.test(value)) {
							return 'Invalid project name.';
						}

						return true;
					}
				},
				{
					type: 'text',
					name: 'project_path',
					message: 'Where should the project be created?',
					initial: './',
					validate(value: string) {
						if (value.length < 1) {
							return 'Project path cannot be empty';
						}

						return true;
					}
				},
				{
					type(_, values) {
						const list = Array.from(
							new Bun.Glob(`${values.project_path}/${values.project_name}/*`).scanSync({
								cwd: cwd()
							})
						);
						return list.length > 0 ? 'toggle' : null;
					},
					name: 'override_path',
					message: 'Directory already exists and not empty. Override?',
					initial: false
				},
				{
					type: 'select',
					name: 'template',
					message: 'Which template would you like to use?',
					choices: [
						{
							title: 'Single Module',
							value: 'single',
							description: 'A single module project'
						},
						{
							title: 'Multi Module',
							value: 'multi',
							description: 'A project optimized for multiple modules (monolith)'
						},
						{
							title: 'Library',
							value: 'library',
							description: 'An Elysium library project',
							disabled: true
						}
					]
				},
				{
					type(_, values) {
						return values.template === 'multi' ? 'list' : null;
					},
					name: 'modules',
					message: 'Which modules would you like to include? (separate by commas)',
					initial: 'main',
					separator: ','
				},
				{
					type: 'multiselect',
					name: 'plugins',
					message: 'Which plugins would you like to include?',
					choices: [
						{
							title: 'Sentry',
							value: 'sentry',
							description: 'Sentry tracing and error reporting (https://sentry.io)'
						}
					]
				},
				{
					type: 'multiselect',
					name: 'features',
					message: 'Select features:',
					choices: [
						{
							title: 'Prettier',
							value: 'prettier',
							description: 'Format code using Prettier (https://prettier.io)'
						},
						{
							title: 'Hephaestus',
							value: 'hephaestus',
							description: 'Build standalone binaries with Hephaestus'
						}
					]
				},
				{
					type: 'confirm',
					name: 'git',
					message: 'Initialize a Git repository?',
					initial: true
				}
			],
			{
				onCancel() {
					process.exit(1);
				},
				onSubmit: (prompt, answer) => {
					if (prompt.name === 'override_path' && answer === false) {
						this.error('Project creation cancelled.');
						process.exit(1);
					}
				}
			}
		);

		const s = this.spinner(`Creating project directory...`);

		const projectPath = resolve(join(cwd(), answers.project_path, answers.project_name));
		const projectExists = await exists(projectPath);

		if (projectExists && answers.override_path) {
			await rm(projectPath, { recursive: true, force: true });
		}

		await mkdir(projectPath, { recursive: true });

		s.update('Copying template files to project directory...');

		const templatePath = join(__dirname, `template-${answers.template}`);
		const templateExists = await exists(templatePath);

		if (!templateExists) {
			s.fail(
				'Unable to find the selected template. Please report this issue on the official GitHub repository at https://github.com/Workerly/elysium'
			);
			process.exit(1);
		}

		await cp(`${templatePath}/`, `${projectPath}/`, {
			recursive: true,
			filter(source) {
				return (
					!source.endsWith('node_modules') &&
					!source.endsWith('.gitkeep') &&
					!source.endsWith('bun.lock')
				);
			}
		});

		const glob = new Bun.Glob(`**`);

		for await (const path of glob.scan({ cwd: projectPath })) {
			const file = Bun.file(join(projectPath, path));
			const contents = await file.text();
			await file.write(contents.replaceAll('{PROJECT_NAME}', answers.project_name));
			await Bun.sleep(1);
		}

		const projectConfig = {
			projectName: answers.project_name,
			mono: answers.template !== 'multi',
			modules: answers.modules
				? objectify(
						answers.modules,
						(m: string) => m,
						(m: string) => `src/modules/${m}`
					)
				: undefined
		};

		const projectConfigFilePath = join(projectPath, '.elysiumrc');
		await Bun.file(projectConfigFilePath).write(JSON.stringify(projectConfig, null, 2));

		if (answers.template === 'single') {
			answers.modules = ['main'];
		}

		for (const module of answers.modules) {
			const modulePath =
				answers.template === 'multi'
					? join(projectPath, 'src', 'modules', module)
					: join(projectPath, 'src');

			await mkdir(modulePath, { recursive: true });

			await cp(`${join(__dirname, 'shared-module')}/`, `${modulePath}/`, {
				recursive: true,
				filter(source) {
					return !source.endsWith('.gitkeep');
				}
			});

			const moduleCode = getModuleCode(pascal(module));
			await Bun.file(join(modulePath, `${snake(module)}.module.ts`)).write(moduleCode);
		}

		const packagesJson = Bun.file(join(projectPath, 'package.json'));
		let patchedPackageJson = assign(await packagesJson.json(), {
			imports:
				answers.template === 'multi'
					? objectify(
							answers.modules,
							(m: string) => `#${m}/*`,
							(m: string) => `./src/modules/${m}/*.ts`
						)
					: { '#root/*': './src/*.ts' }
		});

		s.update('Installing dependencies...');

		await Bun.$`cd ${projectPath} && bun install`.quiet();

		const enabledModules: EnabledModule[] = [];

		const setupPluginOrFeature = async (name: string, kind: 'plugin' | 'feature') => {
			const pluginPath = join(__dirname, `${kind}-${name}`);
			const pluginExists = await exists(pluginPath);

			if (!pluginExists) {
				s.fail(
					`Unable to find the selected ${kind}. Please report this issue on the official GitHub repository at https://github.com/Workerly/elysium`
				);
				process.exit(1);
			}

			await cp(`${pluginPath}/`, `${projectPath}/`, {
				recursive: true,
				filter(source) {
					return !source.endsWith('.specs');
				}
			});

			const specs = await Bun.file(join(pluginPath, '.specs')).json();

			if (specs.packages) {
				const { dev, prod } = specs.packages as { dev: string[]; prod: string[] };

				for (const p of dev ?? []) {
					await Bun.$`cd ${projectPath} && bun add -D ${p}`.quiet();
				}

				for (const p of prod ?? []) {
					await Bun.$`cd ${projectPath} && bun add ${p}`.quiet();
				}
			}

			if (specs.patch) {
				patchedPackageJson = assign(patchedPackageJson, specs.patch);
			}

			if (specs.module) {
				enabledModules.push(specs.module as EnabledModule);
			}
		};

		if (answers.plugins.length > 0) {
			s.update('Installing plugins...');

			for (const plugin of answers.plugins) {
				await setupPluginOrFeature(plugin, 'plugin');
			}
		}

		if (answers.features.length > 0) {
			s.update('Setting up enabled features...');

			for (const feature of answers.features) {
				await setupPluginOrFeature(feature, 'feature');
			}
		}

		await packagesJson.write(
			JSON.stringify(assign(await packagesJson.json(), patchedPackageJson), null, 2)
		);

		for await (const path of glob.scan({ cwd: projectPath })) {
			const file = Bun.file(join(projectPath, path));
			const contents = await file.text();
			const replaced = contents.replaceAll('{PROJECT_NAME}', answers.project_name);
			if (replaced !== contents) {
				await file.write(replaced);
			}
		}

		const appCode = getAppCode(
			answers.project_name,
			objectify(
				answers.modules,
				(m: string) => m,
				(m: string) =>
					answers.template === 'multi' ? `#${m}/${snake(m)}.module` : `#root/${snake(m)}.module`
			),
			enabledModules
		);
		await Bun.file(join(projectPath, 'src', 'app.ts')).write(appCode);

		if (answers.features.includes('prettier')) {
			s.update('Formatting code using Prettier...');
			await Bun.$`cd ${projectPath} && bun run format`.quiet();
		}

		if (answers.git) {
			s.update('Initializing Git repository...');
			await Bun.$`cd ${projectPath} && git init`.quiet();
		}

		s.complete(`Project ${answers.project_name} created successfully`);

		this.info(
			`Open your new project in the terminal with ${this.format(`cd ${relative(cwd(), projectPath)}`, ConsoleFormat.BLUE, ConsoleFormat.BOLD)}`
		);

		this.info(
			`Run ${this.format('bun styx serve', ConsoleFormat.BLUE, ConsoleFormat.BOLD)} to start the project`
		);
	}
}

await new CreateElysiumCommand().run();
