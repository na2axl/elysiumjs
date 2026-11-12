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

import type {
	Application,
	HttpRouteDescription,
	HttpRouteTypes,
	HttpRouteTypesContributor
} from '@elysiumjs/olympus';
import type { ControllerRoutes, ModuleRoutes } from './render';

import { basename, dirname, relative, resolve, sep } from 'node:path';

import { Environments, Http, Service } from '@elysiumjs/olympus';

import { CONTROLLER, quote } from './render';

/**
 * The result of reading the routes of an app.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type CollectedRoutes = {
	/** The modules with controllers, in mounting order. */
	modules: ModuleRoutes[];
	/**
	 * Controllers that no file of the project exports and that no contributor types completely;
	 * their routes are left out.
	 */
	missing: string[];
};

type ModuleNode = ReturnType<typeof Application.moduleGraph>['nodes'][number];

/** Files that never declare controllers for the app. */
const IGNORED = /(\.d|\.test|\.spec)\.tsx?$/;

/** Source files, whose import specifier is the path without the extension. */
const SOURCE = /\.tsx?$/;

/**
 * Finds the file and export name of every class exported by the project files the app has
 * loaded. Importing the app loads every controller its modules list, whatever the file name or
 * the decorator that declares it; importing a loaded file again gives back its exports without
 * running it.
 */
const locateExports = async (
	projectPath: string,
	outFile: string
): Promise<Map<Function, { file: string; exportName: string; className: string }>> => {
	const found = new Map<Function, { file: string; exportName: string; className: string }>();
	const root = resolve(projectPath) + sep;

	for (const file of Object.keys(require.cache).sort()) {
		const path = resolve(file);
		if (!path.startsWith(root) || !SOURCE.test(path) || IGNORED.test(path)) continue;
		if (path === resolve(outFile) || path.includes(`${sep}node_modules${sep}`)) continue;
		const exports: Record<string, unknown> = await import(path);
		for (const [exportName, value] of Object.entries(exports)) {
			if (typeof value === 'function' && !found.has(value)) {
				found.set(value, { file: path, exportName, className: value.name });
			}
		}
	}

	return found;
};

/** The config of a module, best effort: `undefined` when it cannot be evaluated without booting. */
const configOf = async (node: ModuleNode): Promise<unknown> => {
	try {
		const [selected] = [...node.configSources].sort((a, b) => a.depth - b.depth);
		const config = selected?.config;
		const input = typeof config === 'function' ? await (config as () => unknown)() : config;
		const moduleClass = node.moduleClass as { resolveConfig?: (input: unknown) => unknown };
		return typeof moduleClass.resolveConfig === 'function'
			? moduleClass.resolveConfig(input)
			: input;
	} catch {
		return undefined;
	}
};

/**
 * The route types contributors of the app: the service classes its modules register with the
 * `Http.RouteTypes` tag, active in development.
 */
const contributorsOf = async (app: typeof Application): Promise<HttpRouteTypesContributor[]> => {
	const graph = app.moduleGraph('development');
	const contributors: HttpRouteTypesContributor[] = [];
	const seen = new Set<Function>();

	for (const node of graph.nodes) {
		const { services } = node.props;
		let listed: unknown[] = [];
		try {
			listed = typeof services === 'function' ? services(await configOf(node)) : (services ?? []);
		} catch {
			continue;
		}
		for (const def of listed) {
			if (typeof def !== 'function' || seen.has(def)) continue;
			if (!Service.tagsOf(def).includes(Http.RouteTypes)) continue;
			if (!Environments.isActive(def, 'development')) continue;
			seen.add(def);
			contributors.push(new (def as new () => HttpRouteTypesContributor)());
		}
	}

	return contributors;
};

/** Whether `types` give every part of `route` that would otherwise come from the method. */
const complete = (route: HttpRouteDescription, types: HttpRouteTypes | undefined): boolean =>
	types !== undefined &&
	types.response !== undefined &&
	(route.body === undefined || types.body !== undefined) &&
	(route.query === undefined || types.query !== undefined) &&
	(route.params.length === 0 || types.params !== undefined);

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
 * @author Axel Nana <ax.lnana@outlook.com>
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
	const located = await locateExports(projectPath, outFile);
	const contributors = await contributorsOf(app);
	await new Promise((resolve) => process.nextTick(resolve));

	const modules: ModuleRoutes[] = [];
	const missing: string[] = [];

	for (const node of graph.nodes) {
		const controllers: ControllerRoutes[] = [];
		for (const controller of graph.own(node, 'controllers')) {
			const description = Http.describe(controller);
			if (!description) continue;
			const source = located.get(controller);
			const supporting = contributors.filter((contributor) => contributor.supports(controller));

			const types: Record<string, HttpRouteTypes> = {};
			for (const route of description.routes) {
				const method = `${CONTROLLER}[${quote(route.name)}]`;
				const ref = source
					? { method, parameter: (index: number) => `Parameters<${method}>[${index}]` }
					: {};
				for (const contributor of supporting) {
					const given = contributor.route(controller, route, ref);
					if (given) {
						types[route.name] = given;
						break;
					}
				}
			}

			if (!source && !description.routes.every((route) => complete(route, types[route.name]))) {
				missing.push(controller.name);
				continue;
			}
			controllers.push({
				...(source
					? {
							exportName: source.exportName,
							...(source.exportName === 'default' ? { className: defaultName(source) } : {}),
							specifier: specifierFor(outFile, source.file)
						}
					: { className: controller.name }),
				path: description.path,
				routes: description.routes,
				...(Object.keys(types).length > 0 ? { types } : {})
			});
		}
		if (controllers.length > 0) {
			modules.push({ id: node.id, prefix: node.props.prefix, controllers });
		}
	}

	return { modules, missing };
};
