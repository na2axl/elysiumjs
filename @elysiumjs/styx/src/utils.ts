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

import { existsSync } from 'node:fs';
import { mkdir, readdir, rename } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';

import { Application, ElysiumError } from '@elysiumjs/core';
import { pascal } from 'radash';

/**
 * Thrown when the project entry point exports no `Application` subclass.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class AppEntryNotFoundError extends ElysiumError {
	constructor(public readonly path: string) {
		super(`Could not find an exported Application class in ${path}`);
	}
}

/**
 * Loads the project entry (`src/app.ts`, else `index.ts`) and returns its exported `Application` subclass.
 * @author Axel Nana <axel.nana@workbud.com>
 *
 * @param projectPath The root path of the project.
 * @throws {AppEntryNotFoundError} When the entry exports no `Application` subclass.
 */
export const resolveAppEntry = async (projectPath: string): Promise<typeof Application> => {
	const appFile = join(projectPath, 'src', 'app.ts');
	const entry = existsSync(appFile) ? appFile : join(projectPath, 'index.ts');

	const exports: Record<string, unknown> = await import(entry);
	for (const value of Object.values(exports)) {
		if (typeof value === 'function' && value.prototype instanceof Application) {
			return value as typeof Application;
		}
	}

	throw new AppEntryNotFoundError(entry);
};

/**
 * Gets the root path of the styx package.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export const getRootPath = () => {
	return dirname(Bun.fileURLToPath(import.meta.url));
};

/**
 * Gets the root path of the Elysium.js project.
 * @author Axel Nana <axel.nana@workbud.com>
 *
 * @returns The detected project path.
 */
export const getProjectPath = () => {
	let startPath = process.cwd(),
		dir = startPath;

	while (true) {
		if (existsSync(join(dir, '.elysiumrc'))) return dir;

		const parentDir = dirname(dir);
		if (dir === parentDir) break;

		dir = parentDir;
	}

	return startPath;
};

/**
 * Creates a new module or rename an existing module.
 * @author Axel Nana <axel.nana@workbud.com>
 *
 * @param name The name of the module to create or rename.
 * @param oldName The old name of the module to rename.
 */
export const createModule = async (name: string, oldName?: string) => {
	const root = getProjectPath();

	// Create module directory
	{
		const moduleDir = join(root, 'src', 'modules', name);
		await mkdir(moduleDir, { recursive: true });

		if (!oldName) {
			const moduleFile = join(moduleDir, `${name}.module.ts`);
			if (!existsSync(moduleFile)) {
				const className = `${pascal(name)}Module`;
				await Bun.write(
					moduleFile,
					`import { Module } from '@elysiumjs/core';\n\n@Module.register({\n\tservices: [],\n\tcontrollers: [],\n\tcommands: []\n})\nexport class ${className} extends Module {}\n`
				);
			}
		}

		if (oldName) {
			if (oldName === 'root') {
				const entries = await readdir(join(root, 'src'));
				for (const entry of entries) {
					if (['app.ts', 'env.ts', 'database', 'modules'].includes(entry)) continue;
					const oldPath = join(root, 'src', entry);
					const newPath = join(moduleDir, entry === 'main.module.ts' ? `${name}.module.ts` : entry);
					await rename(oldPath, newPath);
				}
			} else {
				const oldModuleDir = join(root, 'src', 'modules', oldName);
				await rename(oldModuleDir, moduleDir);
			}
		}
	}

	// Update package.json imports
	{
		const pkg = await Bun.file(join(root, 'package.json')).json();

		pkg.imports = pkg.imports ?? {};
		pkg.imports[`#${name}/*`] = `./src/modules/${name}/*.ts`;

		if (oldName && oldName !== 'root') {
			delete pkg.imports[`#${oldName}/*`];
		}

		await Bun.write(join(root, 'package.json'), JSON.stringify(pkg, null, 2));
	}

	// Update .elysiumrc
	{
		const rc = await Bun.file(join(root, '.elysiumrc')).json();

		rc.mono = false;
		rc.modules = rc.modules ?? {};
		rc.modules[name] = `./src/modules/${name}`;

		if (oldName) {
			delete rc.modules[oldName];
		}

		await Bun.write(join(root, '.elysiumrc'), JSON.stringify(rc, null, 2));
	}

	// Update imports in all modules
	if (oldName) {
		const rewriteImports = async (dir: string) => {
			const entries = await readdir(dir, { withFileTypes: true });

			for (const entry of entries) {
				const fullPath = join(dir, entry.name);

				if (entry.isDirectory()) {
					await rewriteImports(fullPath);
				} else if (extname(entry.name) === '.ts') {
					let text = await Bun.file(fullPath).text();

					if (oldName === 'root') {
						text = text.replace(
							new RegExp(`(['"])#${oldName}/((?!(env|app|database(?:/|$))).*?)(['"])`, 'g'),
							`$1#${name}/$2$4`
						);
					} else {
						text = text.replace(new RegExp(`(['"])#${oldName}/`, 'g'), `$1#${name}/`);
					}

					text = text.replace(
						new RegExp(`(['"])#${oldName}/main\\.module(['"])/g`, 'g'),
						`$1#${name}/${name}.module$2`
					);

					text = text.replace(
						new RegExp(`(['"])#${oldName}/main\\.module\\.ts(['"])?/g`, 'g'),
						`$1#${name}/${name}.module$2`
					);

					await Bun.write(fullPath, text);
				}
			}
		};

		await rewriteImports(root);
	}
};
