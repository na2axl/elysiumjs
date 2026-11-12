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

import type { HttpRouteDescription, HttpRouteTypes } from '@elysiumjs/olympus';

/**
 * A controller whose routes go in the generated types.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type ControllerRoutes = {
	/**
	 * The exported name of the controller class, `default` for a default export. Left out for a
	 * controller that is not imported, whose route types all come from contributors.
	 */
	exportName?: string;
	/**
	 * The name of the controller class. Names a default export, which has no name of its own, and
	 * a controller that is not imported.
	 */
	className?: string;
	/** The module specifier the generated file imports the class from, unless it is not imported. */
	specifier?: string;
	/** The path of the controller. */
	path: string;
	/** The routes of the controller. */
	routes: HttpRouteDescription[];
	/** The route types given by contributors, by route name. */
	types?: Record<string, HttpRouteTypes>;
};

/**
 * Stands for the local name of the controller class in the type text of contributors, such as
 * `__Controller__['email']`; the rendered file names the class instead.
 */
export const CONTROLLER = '__Controller__';

/**
 * A module whose controllers go in the generated types.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type ModuleRoutes = {
	/** The id of the module. */
	id: string;
	/** The prefix of every controller path in the module. */
	prefix?: string;
	/** The controllers of the module, in mounting order. */
	controllers: ControllerRoutes[];
};

/** Methods Elysia has a dedicated route function for. */
const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

/** A string literal in single quotes. */
export const quote = (value: string) =>
	`'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;

const identifier = (value: string) => value.replace(/[^A-Za-z0-9_$]/g, '_').replace(/^(\d)/, '_$1');

/** The URL parameters of a path, such as `id` in `/users/:id`. */
const pathSlugs = (path: string): string[] =>
	Array.from(path.matchAll(/:([A-Za-z0-9_]+)\??/g), (match) => match[1]!);

/** Renders a route of a controller: its path, hook and handler. */
const renderRoute = (
	controller: string | undefined,
	route: HttpRouteDescription,
	types: HttpRouteTypes = {}
): string => {
	const method = `${controller}[${quote(route.name)}]`;
	const parameter = (index: number) => `Parameters<${method}>[${index}]`;
	const named = (text: string) => (controller ? text.replaceAll(CONTROLLER, controller) : text);
	const hook: string[] = [];

	if (types.params !== undefined) {
		hook.push(`params: schema<${named(types.params)}>()`);
	} else {
		const params = new Map<string, string>();
		for (const slug of pathSlugs(route.path)) params.set(slug, 'string');
		for (const { slug, index } of route.params) params.set(slug, parameter(index));
		if (params.size > 0) {
			const fields = Array.from(params, ([slug, type]) => `${quote(slug)}: ${type}`).join('; ');
			hook.push(`params: schema<{ ${fields} }>()`);
		}
	}
	if (types.query !== undefined) hook.push(`query: schema<${named(types.query)}>()`);
	else if (route.query !== undefined) hook.push(`query: schema<${parameter(route.query)}>()`);
	if (types.body !== undefined) hook.push(`body: schema<${named(types.body)}>()`);
	else if (route.body !== undefined) hook.push(`body: schema<${parameter(route.body)}>()`);

	const response = types.response !== undefined ? named(types.response) : `ReturnType<${method}>`;
	const hookObject = hook.length > 0 ? `{ ${hook.join(', ')} }` : '{}';
	const args = `${quote(route.path)}, ${hookObject}, returns<${response}>()`;
	return METHODS.has(route.method)
		? `.${route.method.toLowerCase()}(${args})`
		: `.route(${quote(route.method)}, ${args})`;
};

/**
 * Renders the file holding the route types of an app, for typed clients such as Eden.
 *
 * The file is type-only: it declares one Elysia chain per module, built from the controller
 * routes, whose parameter, query, body and response types come from the controller method
 * signatures. Nothing in it runs.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @param modules The modules with controllers, in mounting order.
 */
export const renderRoutes = (modules: ModuleRoutes[]): string => {
	const imports = new Map<string, Map<string, string>>();
	const names = new Set<string>();
	const local = new Map<ControllerRoutes, string>();

	const use = (specifier: string, name: string, exported: string) => {
		const specifiers = imports.get(specifier) ?? new Map<string, string>();
		specifiers.set(name, exported);
		imports.set(specifier, specifiers);
	};

	for (const module of modules) {
		for (const controller of module.controllers) {
			for (const types of Object.values(controller.types ?? {})) {
				for (const { from, names: imported } of types.imports ?? []) {
					for (const name of imported) use(from, name, name);
				}
			}
			if (controller.specifier === undefined || controller.exportName === undefined) continue;
			const preferred =
				controller.exportName === 'default' && controller.className
					? controller.className
					: controller.exportName;
			let name = preferred;
			for (let i = 2; names.has(name); i++) name = `${preferred}$${i}`;
			names.add(name);
			local.set(controller, name);
			use(controller.specifier, name, controller.exportName);
		}
	}

	const lines = [
		'// Generated by `styx routes:generate`. Do not edit: run the command again after changing a controller.',
		'/* eslint-disable */',
		"import type { Elysia, t } from '@elysiumjs/olympus';",
		''
	];

	for (const [specifier, specifiers] of [...imports].sort(([a], [b]) => a.localeCompare(b))) {
		const list = Array.from(specifiers, ([name, exported]) =>
			name === exported ? name : `${exported} as ${name}`
		).join(', ');
		lines.push(`import type { ${list} } from ${quote(specifier)};`);
	}

	lines.push(
		'',
		"declare function routes<const Prefix extends string = ''>(prefix?: Prefix): Elysia<Prefix>;",
		'declare function schema<T>(): ReturnType<typeof t.Unsafe<T>>;',
		'declare function returns<T>(): () => T;',
		''
	);

	const moduleNames: string[] = [];
	for (const module of modules) {
		let name = `${identifier(module.id)}Routes`;
		while (moduleNames.includes(name)) name = `_${name}`;
		moduleNames.push(name);

		const controllers = module.controllers.map((controller) => {
			const chain = controller.routes
				.map(
					(route) =>
						`\n\t\t\t\t${renderRoute(local.get(controller), route, controller.types?.[route.name])}`
				)
				.join('');
			return `\n\t\t.use(\n\t\t\troutes(${quote(controller.path)})${chain}\n\t\t)`;
		});
		const prefix = module.prefix ? quote(module.prefix) : '';
		lines.push(`/** The routes of the module ${module.id}. */`);
		lines.push(`const ${name} = () =>\n\troutes(${prefix})${controllers.join('')};`, '');
	}

	const uses = moduleNames.map((name) => `.use(${name}())`).join('');
	lines.push(`const app = () => routes()${uses};`, '');
	lines.push('/** The routes of the app, for typed clients: `treaty<AppRoutes>(url)`. */');
	lines.push('export type AppRoutes = ReturnType<typeof app>;', '');

	return lines.join('\n');
};
