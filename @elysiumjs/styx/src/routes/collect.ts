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

import type { Application } from '@elysiumjs/core';
import type { ControllerRoutes, ModuleRoutes } from './render';

import { basename, dirname, join, relative, resolve } from 'node:path';

import { Http } from '@elysiumjs/core';

/**
 * The result of reading the routes of an app.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type CollectedRoutes = {
	/** The modules with controllers, in mounting order. */
	modules: ModuleRoutes[];
	/** Controllers whose source file was not found in the project; their routes are left out. */
	missing: string[];
};

/** Files that never declare controllers for the app. */
const IGNORED = /(\.d|\.test|\.spec)\.tsx?$/;

/**
 * Finds the file and export name of every controller class declared in the project sources.
 * Only files that mention `Http.controller` are imported.
 */
const locateControllers = async (
	projectPath: string,
	outFile: string
): Promise<Map<Function, { file: string; exportName: string; className: string }>> => {
	const found = new Map<Function, { file: string; exportName: string; className: string }>();
	const glob = new Bun.Glob('**/*.{ts,tsx}');
	const roots = ['src', 'index.ts'];

	for (const root of roots) {
		const base = join(projectPath, root);
		const files = root.endsWith('.ts')
			? (await Bun.file(base).exists())
				? [base]
				: []
			: await Array.fromAsync(glob.scan({ cwd: base, absolute: true })).catch(() => []);

		for (const file of files.sort()) {
			if (IGNORED.test(file) || resolve(file) === resolve(outFile)) continue;
			if (file.includes('/node_modules/')) continue;
			if (!(await Bun.file(file).text()).includes('Http.controller')) continue;
			const exports: Record<string, unknown> = await import(file);
			for (const [exportName, value] of Object.entries(exports)) {
				if (typeof value === 'function' && !found.has(value)) {
					found.set(value, { file, exportName, className: value.name });
				}
			}
		}
	}

	return found;
};

/**
 * The local name of a default-exported controller: its class name, or for an anonymous class, a
 * name derived from its file, such as `UserProfileController` for `user-profile.controller.ts`.
 * An anonymous class is named `default`, or `<file>_default` by Bun.
 */
const defaultName = ({ file, className }: { file: string; className: string }): string => {
	if (className && className !== 'default' && !className.endsWith('_default')) return className;
	const stem = basename(file).replace(/\.[cm]?[jt]sx?$/, '');
	const name = stem
		.split(/[^A-Za-z0-9]+/)
		.filter(Boolean)
		.map((part) => part[0]!.toUpperCase() + part.slice(1))
		.join('');
	return /^[A-Za-z_$]/.test(name) ? name : `_${name}`;
};

/** The import specifier of `file` from the folder of `outFile`, without the extension. */
const specifierFor = (outFile: string, file: string): string => {
	const path = relative(dirname(outFile), file)
		.replaceAll('\\', '/')
		.replace(/\.tsx?$/, '');
	return path.startsWith('.') ? path : `./${path}`;
};

/**
 * Reads the modules, controllers and routes of an app, without booting it.
 * @author Axel Nana <axel.nana@workbud.com>
 * @param projectPath The project folder.
 * @param app The application class, already imported.
 * @param outFile The file the routes will be written to, to compute import paths.
 */
export const collectRoutes = async (
	projectPath: string,
	app: typeof Application,
	outFile: string
): Promise<CollectedRoutes> => {
	// Route decorators register their routes on the next tick.
	await new Promise((resolve) => process.nextTick(resolve));

	const graph = app.moduleGraph('production');
	const located = await locateControllers(projectPath, outFile);
	await new Promise((resolve) => process.nextTick(resolve));

	const modules: ModuleRoutes[] = [];
	const missing: string[] = [];

	for (const node of graph.nodes) {
		const controllers: ControllerRoutes[] = [];
		for (const controller of graph.own(node, 'controllers')) {
			const description = Http.describe(controller);
			if (!description) continue;
			const source = located.get(controller);
			if (!source) {
				missing.push(controller.name);
				continue;
			}
			controllers.push({
				exportName: source.exportName,
				...(source.exportName === 'default' ? { className: defaultName(source) } : {}),
				specifier: specifierFor(outFile, source.file),
				path: description.path,
				routes: description.routes
			});
		}
		if (controllers.length > 0) {
			modules.push({ id: node.id, prefix: node.props.prefix, controllers });
		}
	}

	return { modules, missing };
};
