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
import type { WiredListener } from './event-wiring';
import type { Module } from './module';
import type { ModuleGraph, ModuleNode } from './module-graph';
import type { ServiceDefinition } from './service';

import { isEqual } from 'radash';

import { Container } from './container';
import { ConflictingModuleConfigError, ElysiumError } from './errors';
import { EventBus } from './event';
import { wireEventListeners } from './event-wiring';
import { getModuleProps } from './module';
import { ModuleContext } from './module-context';
import { selectConfig } from './module-graph';
import { Service, ServiceScope } from './service';
import { Symbols } from './utils';

/** The global service name under which the kernel registers itself. */
export const KERNEL_SERVICE = 'elysium.kernel';

type Registered = { name: string; scope: ServiceScope };

const isConfigurable = (cls: unknown): cls is { config: string; resolveConfig(input?: any): any } =>
	typeof (cls as { resolveConfig?: unknown }).resolveConfig === 'function';

const evaluate = (config: unknown): Promise<any> | any =>
	typeof config === 'function' ? config() : config;

const scopeOf = (def: ServiceDefinition): ServiceScope =>
	(typeof def === 'function'
		? Reflect.getMetadata(Symbols.serviceOptions, def)?.scope
		: def.scope) ?? ServiceScope.SINGLETON;

const nameOf = (def: ServiceDefinition): string =>
	typeof def === 'function'
		? (Reflect.getMetadata(Symbols.serviceOptions, def)?.name ?? def.name)
		: def.name;

/**
 * Turns a module graph into a running container: registers configs and services,
 * initialises modules (eagerly or on demand) and shuts everything down in order.
 *
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class Kernel {
	private readonly instances = new Map<ModuleNode, Module>();
	private readonly registered = new Map<ModuleNode, Registered[]>();
	private readonly initialised = new Set<ModuleNode>();
	private readonly initialising = new Set<ModuleNode>();
	private readonly initOrder: ModuleNode[] = [];
	private readonly inFlight = new Map<ModuleNode, Promise<void>>();
	private readonly failures = new Map<ModuleNode, { error: unknown }>();
	private readonly ownClasses = new Map<
		ModuleNode,
		{ owned: Class<any>[]; services: Set<Class<any>> }
	>();
	private readonly wired: WiredListener[] = [];
	private shutdownPromise: Promise<void> | undefined;

	public constructor(private readonly moduleGraph: ModuleGraph) {}

	/** The module graph this kernel runs. */
	public get graph(): ModuleGraph {
		return this.moduleGraph;
	}

	/**
	 * Phase 2: resolves each module's config, instantiates the module and registers its services.
	 * @throws {ConflictingModuleConfigError | MissingModuleConfigError}
	 */
	public async register(): Promise<void> {
		const { graph } = this;
		// Lets modules reach the graph (e.g. to collect `jobs`) without an Application instance.
		Service.instance(KERNEL_SERVICE, this);
		Container.setVisibility(graph);
		Container.setModuleInitHook((node) =>
			this.initialised.has(node) || this.initialising.has(node) || this.initSync(node)
				? undefined
				: this.initModule(node)
		);
		Container.setSkippedLookup(this.buildSkippedLookup());

		for (const node of graph.nodes) {
			const config = await this.resolveNodeConfig(node);
			const instance = ModuleContext.run(node, () => Service.make(node.moduleClass));
			Reflect.defineMetadata(Symbols.moduleConfig, config, instance);
			this.instances.set(node, instance);

			const registered: Registered[] = [];
			if (isConfigurable(node.moduleClass)) {
				Container.register(node, { name: node.moduleClass.config, factory: () => config }, config);
			}
			const { services } = node.props;
			const defs = typeof services === 'function' ? services(config) : (services ?? []);
			const serviceClasses = defs.filter((d): d is Class<any> => typeof d === 'function');
			this.ownClasses.set(node, {
				owned: [...serviceClasses, ...(node.props.controllers ?? [])],
				services: new Set(serviceClasses)
			});
			for (const def of defs) {
				registered.push({ name: Container.register(node, def, config), scope: scopeOf(def) });
			}
			this.registered.set(node, registered);
		}
	}

	/**
	 * Initialises a module, after its imports. Idempotent: concurrent callers share one run,
	 * and a failure is remembered and rethrown.
	 */
	public initModule(node: ModuleNode): Promise<void> {
		if (this.initialised.has(node)) return Promise.resolve();
		const failure = this.failures.get(node);
		if (failure) return Promise.reject(failure.error);
		let pending = this.inFlight.get(node);
		if (!pending) {
			pending = this.runInit(node);
			pending.catch(() => {});
			this.inFlight.set(node, pending);
		}
		return pending;
	}

	/** Initialises every module in graph order, then constructs every non-factory service. */
	public async bootEager(): Promise<void> {
		for (const node of this.graph.nodes) await this.initModule(node);
		for (const node of this.graph.nodes) {
			for (const { name, scope } of this.registered.get(node) ?? []) {
				if (scope === ServiceScope.FACTORY) continue;
				await ModuleContext.run(node, () => Service.resolve(name));
			}
		}
	}

	/**
	 * Lazily builds a class owned by `owner`, such as a command: initialises the owner,
	 * awaits its injected dependencies, then constructs it in the owner's context.
	 */
	public async prepare<T>(cls: Class<T>, owner: ModuleNode): Promise<T> {
		await this.initModule(owner);
		const dependencies: { name: string }[] = Reflect.getMetadata(Symbols.services, cls) ?? [];
		for (const { name } of dependencies) {
			await ModuleContext.run(owner, () => Container.resolve(name, cls.name));
		}
		return ModuleContext.run(owner, () => Service.make(cls));
	}

	/** The instance of a registered module. */
	public moduleInstance(node: ModuleNode): Module {
		const instance = this.instances.get(node);
		if (!instance) throw new ElysiumError(`Module ${node.id} has not been registered.`);
		return instance;
	}

	/**
	 * Destroys constructed services in reverse construction order, then initialised
	 * modules in reverse init order. Errors are logged, not thrown. Idempotent.
	 */
	public shutdown(): Promise<void> {
		this.shutdownPromise ??= this.runShutdown();
		return this.shutdownPromise;
	}

	private async runInit(node: ModuleNode): Promise<void> {
		for (const imported of node.imports) await this.initModule(imported);
		await this.initOwn(node);
	}

	/**
	 * Wires the listeners and runs the `onInit` of a module whose imports are initialised.
	 * The module is recorded as initialised at once when `onInit` is synchronous.
	 * @returns A promise when `onInit` is asynchronous.
	 */
	private initOwn(node: ModuleNode): Promise<void> | undefined {
		const instance = this.moduleInstance(node);
		const own = this.ownClasses.get(node);
		if (own) this.wired.push(...wireEventListeners(node, own.owned, own.services));
		// While onInit runs, the module's own services resolve without re-entering init.
		this.initialising.add(node);
		let result: unknown;
		try {
			result = ModuleContext.run(node, () => instance.onInit());
		} catch (error) {
			this.initialising.delete(node);
			throw error;
		}
		const done = () => {
			this.initialising.delete(node);
			this.initialised.add(node);
			this.initOrder.push(node);
		};
		if (typeof (result as { then?: unknown } | null)?.then === 'function') {
			return Promise.resolve(result).then(done, (error) => {
				this.initialising.delete(node);
				throw error;
			});
		}
		done();
		return undefined;
	}

	/**
	 * Initialises a module synchronously when that is possible: every import is (or can be
	 * made) initialised the same way and `onInit` returns no promise.
	 * @returns Whether the module is initialised. When `false`, its initialisation is
	 * asynchronous and has been started or is in flight.
	 * @throws The error of a failing synchronous `onInit`, which is remembered.
	 */
	private initSync(node: ModuleNode): boolean {
		if (this.initialised.has(node) || this.initialising.has(node)) return true;
		const failure = this.failures.get(node);
		if (failure) throw failure.error;
		if (this.inFlight.has(node)) return false;
		for (const imported of node.imports) {
			if (!this.initSync(imported)) return false;
		}

		let pending: Promise<void> | undefined;
		try {
			pending = this.initOwn(node);
		} catch (error) {
			this.failures.set(node, { error });
			throw error;
		}
		if (!pending) return true;
		pending.catch(() => {});
		this.inFlight.set(node, pending);
		return false;
	}

	private async runShutdown(): Promise<void> {
		for (const { event, wrapper } of this.wired.splice(0)) {
			EventBus.instance.removeListener(event, wrapper);
		}

		const targets = [
			...Container.constructed()
				.map(({ name, instance, owner }) => ({ label: `service ${name}`, instance, owner }))
				.reverse(),
			...[...this.initOrder].reverse().map((node) => ({
				label: `module ${node.id}`,
				instance: this.instances.get(node),
				owner: node
			}))
		];

		for (const { label, instance, owner } of targets) {
			const onDestroy = (instance as { onDestroy?: () => unknown } | undefined)?.onDestroy;
			if (typeof onDestroy !== 'function') continue;
			try {
				const call = () => onDestroy.call(instance);
				await (owner ? ModuleContext.run(owner, call) : call());
			} catch (error) {
				console.error(`Error while destroying ${label}:`, error);
			}
		}
	}

	/** Evaluates the config that applies to `node`, checking function-form ties. */
	private async resolveNodeConfig(node: ModuleNode): Promise<unknown> {
		const selected = selectConfig(node);
		let input: unknown;
		if (selected) {
			input = await evaluate(selected.config);
			const tied = node.configSources.filter((s) => s.depth === selected.depth);
			if (tied.length > 1 && tied.some((s) => typeof s.config === 'function')) {
				for (const other of tied.filter((s) => s !== selected)) {
					if (!isEqual(input, await evaluate(other.config))) {
						throw new ConflictingModuleConfigError(node.id, [selected.site, other.site]);
					}
				}
			}
		}
		return isConfigurable(node.moduleClass) ? node.moduleClass.resolveConfig(input) : undefined;
	}

	/** Maps class and factory service names of skipped modules to the module that declares them. */
	private buildSkippedLookup() {
		const owners = new Map<string, string>();
		for (const cls of this.graph.skipped) {
			const { services } = getModuleProps(cls);
			if (!Array.isArray(services)) continue;
			for (const def of services) owners.set(nameOf(def), cls.name);
		}
		const { environment } = this.graph;
		return (name: string) => {
			const module = owners.get(name);
			return module === undefined ? null : { module, environment };
		};
	}
}
