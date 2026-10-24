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

import type { Class } from 'type-fest';
import type { ConfiguredModule, ModuleClass, ModuleProps } from './module';

import { isEqual } from 'radash';

import { getCommandName } from './command';
import {
	ConflictingModuleConfigError,
	DuplicateCommandError,
	DuplicateModuleNameError,
	ModuleCycleError
} from './errors';
import { getModuleProps, isConfiguredModule } from './module';
import { currentEnvironment, Symbols } from './utils';

/** The import site used for modules listed directly in the application. */
const APP_SITE = '<app>';

/**
 * A configuration given to a module from one import site.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type ConfigSource = {
	readonly site: string;
	readonly depth: number;
	readonly config: ConfiguredModule<unknown>['config'];
};

/**
 * A module in the graph.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type ModuleNode = {
	readonly id: string;
	readonly moduleClass: ModuleClass;
	readonly props: ModuleProps;
	readonly imports: readonly ModuleNode[];
	readonly depth: number;
	readonly configSources: readonly ConfigSource[];
};

type Collectable = 'controllers' | 'commands' | 'jobs';

/**
 * The resolved module graph.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type ModuleGraph = {
	/** Active modules, imports first. */
	readonly nodes: readonly ModuleNode[];

	/** Modules excluded by their `env`. */
	readonly skipped: readonly ModuleClass[];

	/** The environment the graph was built for. */
	readonly environment: string;

	node(cls: ModuleClass): ModuleNode | undefined;

	/** The direct imports of `node`, plus the modules they re-export. */
	visibleOwners(node: ModuleNode): readonly ModuleNode[];

	/** The service names `node` exports, or `true` when it exports everything. */
	exportsOf(node: ModuleNode): readonly string[] | true;

	/** Gathers controllers, commands or jobs across modules, with their owner. */
	collect<K extends Collectable>(key: K): readonly { item: Class<any>; module: ModuleNode }[];
};

type Entry = ModuleClass | ConfiguredModule<any>;

type Record_ = {
	cls: ModuleClass;
	props: ModuleProps;
	imports: ModuleClass[];
	configs: { target: ModuleClass; config: ConfiguredModule<unknown>['config'] }[];
};

const unwrap = (entry: Entry): ModuleClass => (isConfiguredModule(entry) ? entry.module : entry);

const isActive = (props: ModuleProps, environment: string) =>
	props.env === undefined || props.env.includes(environment);

/** Walks the import tree depth-first, producing records in topological order. */
function discover(roots: Entry[], environment: string) {
	const records = new Map<ModuleClass, Record_>();
	const skipped: ModuleClass[] = [];
	const done = new Set<ModuleClass>();
	const stack: ModuleClass[] = [];

	const visit = (cls: ModuleClass): void => {
		if (done.has(cls)) return;
		const at = stack.indexOf(cls);
		if (at !== -1) {
			throw new ModuleCycleError([...stack.slice(at), cls].map((c) => c.name));
		}

		const props = getModuleProps(cls);
		if (!isActive(props, environment)) {
			if (!skipped.includes(cls)) skipped.push(cls);
			return;
		}

		stack.push(cls);
		const record: Record_ = { cls, props, imports: [], configs: [] };
		for (const entry of props.imports ?? []) {
			const target = unwrap(entry);
			visit(target);
			if (!records.has(target) && !done.has(target)) continue;
			if (!record.imports.includes(target)) record.imports.push(target);
			if (isConfiguredModule(entry)) record.configs.push({ target, config: entry.config });
		}
		stack.pop();

		done.add(cls);
		records.set(cls, record);
	};

	for (const root of roots) visit(unwrap(root));
	return { records, skipped };
}

/** Computes the shortest distance from the application for every module. */
function computeDepths(roots: ModuleClass[], records: Map<ModuleClass, Record_>) {
	const depths = new Map<ModuleClass, number>();
	let frontier = roots.filter((r) => records.has(r));
	frontier.forEach((r) => depths.set(r, 1));
	for (let depth = 1; frontier.length > 0; depth++) {
		const next: ModuleClass[] = [];
		for (const cls of frontier) {
			for (const imported of records.get(cls)!.imports) {
				if (!depths.has(imported)) {
					depths.set(imported, depth + 1);
					next.push(imported);
				}
			}
		}
		frontier = next;
	}
	return depths;
}

function commandsOf(props: ModuleProps, environment: string): Class<any>[] {
	return (props.commands ?? []).filter(
		(c) => !(environment === 'production' && (c as any).dev === true)
	);
}

function assertUniqueNames(classes: readonly ModuleClass[]) {
	const seen = new Map<string, ModuleClass>();
	for (const cls of classes) {
		const other = seen.get(cls.name);
		if (other !== undefined && other !== cls) throw new DuplicateModuleNameError(cls.name);
		seen.set(cls.name, cls);
	}
}

function assertUniqueCommands(nodes: readonly ModuleNode[], environment: string) {
	const seen = new Map<string, string>();
	for (const node of nodes) {
		for (const command of commandsOf(node.props, environment)) {
			const name = getCommandName(command);
			const owner = seen.get(name);
			if (owner !== undefined && owner !== node.id) {
				throw new DuplicateCommandError(name, [owner, node.id]);
			}
			seen.set(name, node.id);
		}
	}
}

const isModuleClass = (value: unknown): value is ModuleClass =>
	typeof value === 'function' && Reflect.getMetadata(Symbols.module, value) !== undefined;

const serviceName = (cls: Class<any>): string =>
	Reflect.getMetadata(Symbols.serviceOptions, cls)?.name ?? cls.name;

/**
 * Builds the module graph from decorator metadata. Pure: constructs nothing.
 *
 * @param rootModules The modules declared by the application.
 * @param environment The active environment.
 * @throws {ModuleCycleError} On an import cycle.
 * @throws {DuplicateModuleNameError} When two different module classes share a name.
 * @throws {DuplicateCommandError} When two modules register the same command.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export function buildModuleGraph(
	rootModules: Entry[],
	environment: string = currentEnvironment()
): ModuleGraph {
	const { records, skipped } = discover(rootModules, environment);
	assertUniqueNames([...records.keys()]);
	const rootClasses = rootModules.map(unwrap);
	const depths = computeDepths(rootClasses, records);

	const sources = new Map<ModuleClass, ConfigSource[]>();
	const addSource = (target: ModuleClass, source: ConfigSource) =>
		sources.set(target, [...(sources.get(target) ?? []), source]);

	for (const root of rootModules) {
		const target = unwrap(root);
		if (isConfiguredModule(root) && records.has(target)) {
			addSource(target, { site: APP_SITE, depth: 1, config: root.config });
		}
	}
	for (const record of records.values()) {
		for (const { target, config } of record.configs) {
			addSource(target, {
				site: record.cls.name,
				depth: depths.get(record.cls)! + 1,
				config
			});
		}
	}

	const byClass = new Map<ModuleClass, ModuleNode>();
	for (const record of records.values()) {
		byClass.set(record.cls, {
			id: record.cls.name,
			moduleClass: record.cls,
			props: record.props,
			imports: record.imports.map((i) => byClass.get(i)!),
			depth: depths.get(record.cls)!,
			configSources: sources.get(record.cls) ?? []
		});
	}
	const nodes = [...byClass.values()];

	assertUniqueCommands(nodes, environment);

	const visibleOwners = (node: ModuleNode): readonly ModuleNode[] => {
		const result: ModuleNode[] = [];
		const add = (owner: ModuleNode | undefined) => {
			if (owner === undefined || result.includes(owner)) return;
			result.push(owner);
			const exported = owner.props.exports;
			if (Array.isArray(exported)) {
				for (const entry of exported) if (isModuleClass(entry)) add(byClass.get(entry));
			}
		};
		node.imports.forEach(add);
		return result;
	};

	const exportsOf = (node: ModuleNode): readonly string[] | true => {
		const exported = node.props.exports;
		if (exported === true) return true;
		return (exported ?? [])
			.filter((e) => !isModuleClass(e))
			.map((e) => (typeof e === 'string' ? e : serviceName(e as Class<any>)));
	};

	const collect = <K extends Collectable>(key: K) =>
		nodes.flatMap((module) => {
			const items =
				key === 'commands'
					? commandsOf(module.props, environment)
					: ((module.props[key] ?? []) as Class<any>[]);
			return items.map((item) => ({ item, module }));
		});

	return {
		nodes,
		skipped,
		environment,
		node: (cls) => byClass.get(cls),
		visibleOwners,
		exportsOf,
		collect
	};
}

/**
 * Picks the configuration that applies to a module: the one from the lowest depth.
 * Equal object-form configs at the same depth are accepted; different ones conflict.
 * Function-form configs are not compared here.
 *
 * @throws {ConflictingModuleConfigError} When two different object configs tie.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export function selectConfig(node: ModuleNode): ConfigSource | undefined {
	if (node.configSources.length === 0) return undefined;
	const best = Math.min(...node.configSources.map((s) => s.depth));
	const tied = node.configSources.filter((s) => s.depth === best);

	const objects = tied.filter((s) => typeof s.config !== 'function');
	for (const other of objects.slice(1)) {
		if (!isEqual(objects[0].config, other.config)) {
			throw new ConflictingModuleConfigError(node.id, [objects[0].site, other.site]);
		}
	}
	return tied[0];
}
