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

import type { ElysiaOpenAPIConfig } from '@elysia/openapi';
import type { AnyElysia, ErrorContext } from 'elysia';
import type { TSchema } from 'typebox';
import type { CommandClass } from './command';
import type { ElysiaApp, Route } from './http';
import type { ConfiguredModule, ModuleClass } from './module';
import type { ModuleGraph, ModuleNode } from './module-graph';
import type { Runtime as RuntimePort } from './runtime';
import type { TestingApp, TestingOptions } from './testing';
import type { ElysiaPlugin } from './utils';

import { AsyncLocalStorage } from 'node:async_hooks';

import { openapi as openapiPlugin } from '@elysia/openapi';
import { Elysia, ElysiaStatus } from 'elysia';
import { first } from 'radash';
import Value from 'typebox/value';

import { getCommandName } from './command';
import { ConsoleFormat, InteractsWithConsole } from './console';
import { initEnv } from './env';
import { ElysiumError, InvalidControllerError } from './errors';
import { Event } from './event';
import { Kernel } from './kernel';
import { getLogger } from './logger';
import { Metadata } from './metadata';
import { applyMiddlewares, middlewareStops } from './middleware';
import { ModuleContext } from './module-context';
import { buildModuleGraph } from './module-graph';
import { Runtime } from './runtime';
import { Service } from './service';
import { createTestingApp } from './testing';
import { deepMerge, Symbols } from './utils';

/**
 * An application plugin, consisting of a function that returns an Elysia instance.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type ElysiumPlugin = (app: Application) => Promise<AnyElysia>;

/**
 * Properties required when declaring an app using the `@Application.register()` decorator.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type AppProps = {
	/**
	 * Enables or disables debug mode.
	 */
	debug?: boolean;

	/**
	 * The Elysia server configuration.
	 */
	server?: ElysiaConfig & {
		/**
		 * The port to listen on.
		 */
		port?: number;
	};

	/**
	 * The runtime the application runs on, from `@elysiumjs/runtime-bun`, `@elysiumjs/runtime-node`
	 * or `@elysiumjs/runtime-workers`. Can be omitted when `Runtime.use()` was called before.
	 */
	runtime?: RuntimePort;

	/**
	 * The modules the application is made of. They act as the imports of the root module.
	 */
	modules?: (ModuleClass | ConfiguredModule<any>)[];

	/**
	 * OpenAPI documentation configuration.
	 *
	 * Set it to `false` to disable OpenAPI documentation.
	 */
	openapi?: ElysiaOpenAPIConfig<boolean, string> | false;

	/**
	 * The validation schema for the application environment.
	 */
	env?: TSchema;

	/**
	 * The list of plugins to load.
	 */
	plugins?: ElysiumPlugin[];
};

/** The options of the root Elysia app. */
type ElysiaConfig = NonNullable<ConstructorParameters<typeof Elysia>[0]>;

/**
 * An error raised while handling a request, as given to the Elysia error hook. `code` is set for
 * the errors Elysia raises ('validation', 'not-found', ...).
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type ServerError = ErrorContext & { code?: string; error: any };

/**
 * Type for the application context.
 *
 * - `tenant`: the current tenant.
 * - `http:context`: the context of the HTTP request being handled.
 * - `db:transactions`: the open database transactions, keyed by the connection they run on.
 * - `db:tx`: the transaction open on the default database connection. Kept for existing callers;
 *   prefer `db:transactions`.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type AppContext = AsyncLocalStorage<
	Map<'tenant' | 'http:context' | 'db:transactions' | 'db:tx', unknown>
>;

/** Context used when no application instance exists, for instance under `Application.testing`. */
const fallbackContext: AppContext = new AsyncLocalStorage();

/**
 * Base class for the application main entry.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export abstract class Application extends InteractsWithConsole {
	// @ts-expect-error The property is not initialized in the constructor.
	#elysia: Elysia<Route>;
	#debug: boolean;
	#kernel: Kernel | undefined;
	#removeShutdownHandler: (() => void) | undefined;

	private readonly _appContextStorage: AppContext = new AsyncLocalStorage();

	/**
	 * Gets the running application instance.
	 */
	public static get instance(): Application {
		return Service.get<Application>('elysium.app')!;
	}

	/**
	 * Gets the application context shared between asynchronous operations.
	 * Falls back to a module-level storage when no application instance exists.
	 */
	public static get context(): AppContext {
		return Application.instance?._appContextStorage ?? fallbackContext;
	}

	/**
	 * Marks a class as the application main entry.
	 * @param props The decorator options.
	 */
	public static register(props: AppProps = {}): ClassDecorator {
		return function (target) {
			// The nearest ancestor's metadata already includes its own ancestors.
			let parentMetadata: AppProps | undefined;
			let proto = Object.getPrototypeOf(target);
			while (proto && proto !== Object.prototype) {
				parentMetadata = Metadata.getOwn(Symbols.app, proto);
				if (parentMetadata) break;
				proto = Object.getPrototypeOf(proto);
			}

			const ownMetadata: AppProps | undefined = Metadata.getOwn(Symbols.app, target);

			// Modules are concatenated (parent first) and never merged, so that configured modules
			// keep their config intact.
			const modules = [
				...(parentMetadata?.modules ?? []),
				...(ownMetadata?.modules ?? []),
				...(props.modules ?? [])
			];
			// The runtime is kept as given, never deep-copied.
			const runtime = props.runtime ?? ownMetadata?.runtime ?? parentMetadata?.runtime;
			const withoutModules = ({
				modules: _modules,
				runtime: _runtime,
				...rest
			}: AppProps): AppProps => rest;

			// Precedence, highest first: own props, own metadata, parent metadata, defaults.
			props = {
				...deepMerge<AppProps>(
					withoutModules(props),
					withoutModules(ownMetadata ?? {}),
					withoutModules(parentMetadata ?? {}),
					{ openapi: false }
				),
				modules,
				...(runtime ? { runtime } : {})
			};

			// Store the merged metadata
			Metadata.define(Symbols.app, props, target);
		};
	}

	/**
	 * Creates a new instance of the application.
	 */
	public constructor() {
		super();

		const { env, debug, runtime }: AppProps = Metadata.get(Symbols.app, this.constructor) ?? {};
		this.#debug = debug ?? false;
		if (runtime) Runtime.use(runtime);

		const runtimeEnv = Runtime.get().env();
		if (env) {
			const rawEnv = Value.Convert(env, Value.Clone(runtimeEnv));

			if (this.#debug && !Value.Check(env, rawEnv)) {
				const error = Value.Errors(env, rawEnv)[0];
				this.trace(error! as unknown as Error, 'Invalid environment configuration');
			}

			initEnv(Value.Clean(env, rawEnv) as Record<string, unknown>);
		} else {
			initEnv(runtimeEnv);
		}

		Service.remove('elysium.app');
		Service.instance('elysium.app', this);
	}

	/**
	 * Creates the application and runs it.
	 * @author Axel Nana <axel.nana@workbud.com>
	 */
	public static start<T extends Application>(this: new () => T): Promise<void> {
		return new this().run();
	}

	/**
	 * Boots a module graph without a CLI or an HTTP server, for tests.
	 * @param options The modules to boot, service overrides, environment and boot mode.
	 * @author Axel Nana <axel.nana@workbud.com>
	 */
	public static testing(options: TestingOptions): Promise<TestingApp> {
		return createTestingApp(options);
	}

	/**
	 * The kernel running this application's module graph. Available once `run()` has started.
	 */
	public get kernel(): Kernel {
		if (!this.#kernel) throw new ElysiumError('The application has not been started yet.');
		return this.#kernel;
	}

	/**
	 * Gets the Elysia instance.
	 */
	public get elysia(): Elysia<Route> {
		return this.#elysia;
	}

	/**
	 * Gets the debug mode flag.
	 */
	public get isDebug(): boolean {
		return this.#debug;
	}

	/**
	 * Sets the debug mode flag.
	 * @param debug The debug mode flag.
	 */
	public set isDebug(debug: boolean) {
		this.#debug = debug;
	}

	/**
	 * Hook that is executed when an error occurs.
	 * @param _error The error context.
	 * @returns Whether to continue the error propagation.
	 */
	protected async onError(_error: ServerError): Promise<boolean> {
		return true;
	}

	/**
	 * Hook that is executed when the application starts.
	 * @param _elysia The Elysia instance.
	 */
	protected async onStart(_elysia: Elysia<Route>): Promise<void> {}

	/**
	 * Hook that is executed when the application stops.
	 * @param _elysia The Elysia instance.
	 */
	protected async onStop(_elysia: Elysia<Route>): Promise<void> {}

	/**
	 * Runs the CLI action given in `argv`: describe, `list`, `help`, `serve` or a command.
	 * Prints any error and exits with a non-zero code.
	 * @param argv The command line arguments, without the executable and script.
	 * @author Axel Nana <axel.nana@workbud.com>
	 */
	public async run(argv: string[] = process.argv.slice(2)): Promise<void> {
		this.installSignalHandlers();
		try {
			const { modules } = this.props();
			this.#kernel = new Kernel(buildModuleGraph(modules ?? []));
			return await this.dispatch(argv);
		} catch (error) {
			return this.fail(error);
		}
	}

	private props(): AppProps {
		return Metadata.get(Symbols.app, this.constructor) ?? {};
	}

	/**
	 * Builds the module graph of an application class without creating or booting anything.
	 * Used by tools that read the app's structure, such as the route type generator.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param environment The environment to build the graph for. Defaults to the current one.
	 */
	public static moduleGraph(environment?: string): ModuleGraph {
		const { modules }: AppProps = Metadata.get(Symbols.app, this) ?? {};
		return buildModuleGraph(modules ?? [], environment);
	}

	private async dispatch([action, ...rest]: string[]): Promise<void> {
		switch (action) {
			case undefined:
				this.commandDescribe();
				return this.exit(0);
			case 'serve':
				return this.commandServe();
			case 'list':
				this.write(this.bold('Available commands:'));
				this.commandList();
				return this.exit(0);
			case 'help':
				return this.commandHelp(rest[0]);
			default:
				return this.commandExec(action, rest);
		}
	}

	/** Prints an error, shuts down what was started and exits with code 1. */
	private async fail(error: unknown): Promise<void> {
		const message = error instanceof Error ? error.message : String(error);
		this.error(message);
		if (!(error instanceof ElysiumError) && this.isDebug) this.trace(error as Error);
		Event.emit('elysium:error', error);
		await this.#kernel?.shutdown();
		return this.exit(1);
	}

	/** Exits the process, after detaching the signal handlers. */
	private exit(code: number): void {
		this.removeSignalHandlers();
		return Runtime.get().exit(code);
	}

	private removeSignalHandlers(): void {
		this.#removeShutdownHandler?.();
		this.#removeShutdownHandler = undefined;
	}

	private installSignalHandlers(): void {
		this.removeSignalHandlers();
		const onSignal = async () => {
			this.removeSignalHandlers();
			let code = 0;
			try {
				await this.#elysia?.stop();
			} catch (error) {
				code = 1;
				this.error(error instanceof Error ? error.message : String(error));
			} finally {
				try {
					await this.#kernel?.shutdown();
				} catch (error) {
					code = 1;
					this.error(error instanceof Error ? error.message : String(error));
				}
				this.exit(code);
			}
		};
		this.#removeShutdownHandler = Runtime.get().onShutdown(onSignal);
	}

	/** The commands available in the module graph, with their owning module. */
	private getCommands(): { item: CommandClass; module: ModuleNode }[] {
		return this.kernel.graph.collect('commands') as { item: CommandClass; module: ModuleNode }[];
	}

	private findCommand(name: string) {
		return this.getCommands().find(({ item }) => getCommandName(item) === name);
	}

	/**
	 * Builds a command inside its owning module: lazily by default, after an eager boot
	 * when the command sets `boot`.
	 */
	private async prepareCommand(
		{ item, module }: { item: CommandClass; module: ModuleNode },
		forHelp = false
	) {
		const eager = item.boot && !forHelp;
		await this.bootKernel(eager);
		if (!eager) return this.kernel.prepare(item, module);
		return ModuleContext.run(module, () => Service.make(item));
	}

	/** Registers the kernel (and boots it eagerly if asked), then announces the launch. */
	private async bootKernel(eager: boolean): Promise<void> {
		await this.kernel.register();
		if (eager) await this.kernel.bootEager();
		Event.emit('elysium:app:launched', this, this);
	}

	/**
	 * Prints the help of a command.
	 * @param name The command name.
	 */
	private async commandHelp(name: string | undefined): Promise<void> {
		const found = name ? this.findCommand(name) : undefined;
		if (!found) {
			this.error(
				name ? `Command <${name}> not found.` : 'No command provided. Usage: styx help <command>'
			);
			this.commandList();
			return this.exit(1);
		}

		const command = await this.prepareCommand(found, true);
		this.write(await ModuleContext.run(found.module, () => command.help()));
		await this.kernel.shutdown();
		return this.exit(0);
	}

	/**
	 * Executes a command.
	 * @param name The command to execute.
	 * @param argv The command line arguments.
	 */
	private async commandExec(name: string, argv: string[]): Promise<void> {
		const found = this.findCommand(name);
		if (!found) {
			this.error(`Command ${name} not found`);
			this.commandList();
			return this.exit(1);
		}

		const command = await this.prepareCommand(found);
		await ModuleContext.run(found.module, async () => {
			if (await command.init(...argv)) {
				await command.run();
			} else {
				this.write(await command.help());
			}
		});
		await this.kernel.shutdown();
		return this.exit(0);
	}

	/**
	 * Builds the root Elysia app without listening, for hosts that own the server (Cloudflare
	 * Workers) and for ahead-of-time compilation with `elysia/plugin/aot`, which evaluates the
	 * entry at build time.
	 *
	 * Modules are registered but not initialised: they boot on the first request, so building the
	 * app runs no `onInit` work and builds no service.
	 *
	 * @example
	 * ```ts
	 * export const app = await new App().build();
	 * export default { fetch: (request: Request) => app.fetch(request) };
	 * ```
	 * @returns The root Elysia app.
	 * @throws When the module graph is invalid or a module config is missing.
	 */
	public async build(): Promise<Elysia<Route>> {
		const { modules } = this.props();
		this.#kernel = new Kernel(buildModuleGraph(modules ?? []));
		await this.bootKernel(false);
		await this.buildServer(true);
		return this.#elysia;
	}

	/** Starts the server: boots the kernel, builds the root Elysia app and listens. */
	private async commandServe(): Promise<void> {
		const { server } = this.props();

		await this.bootKernel(true);
		await this.buildServer(false);

		const runtime = Runtime.get();
		runtime.serve(this.#elysia, server?.port ?? (parseInt(runtime.env().PORT ?? '', 10) || 3000));
	}

	/**
	 * Builds the root Elysia app: lets modules hook into it and mounts their controllers.
	 * @param bootOnFirstRequest Whether the first request boots the modules, when they were only
	 * registered.
	 */
	private async buildServer(bootOnFirstRequest: boolean): Promise<void> {
		const { server, openapi, plugins } = this.props();

		this.#elysia = new Elysia(server) as unknown as Elysia<Route>;

		// First of the hooks, so that every later one finds the modules initialised.
		if (bootOnFirstRequest) {
			let booted = false;
			let booting: Promise<void> | undefined;
			this.#elysia.onRequest(() => {
				if (booted) return;
				booting ??= this.kernel.bootEager().then(() => {
					booted = true;
				});
				return booting;
			});
		}

		this.#elysia.onRequest((c) => {
			if (this.isDebug) {
				getLogger().debug('Incoming request', { method: c.request.method, url: c.request.url });
			}
		});

		Event.emit('elysium:server:before-init', this, this);

		// Keeps a tenant already resolved by a middleware, which runs before this hook.
		this.#elysia.derive('global', (ctx) => ({
			tenant:
				(ctx as { tenant?: string }).tenant ?? ctx.request.headers.get('x-tenant-id') ?? 'public'
		}));

		if (openapi) {
			this.#elysia.use(openapiPlugin(openapi));
		}

		for (const plugin of plugins ?? []) {
			this.#elysia.use(await plugin(this));
		}

		this.setupServerHooks();

		const middlewares = Metadata.get(Symbols.middlewares, this.constructor) ?? [];
		applyMiddlewares(middlewares, this.#elysia, null);

		await this.serveModules();

		Event.emit('elysium:server:after-init', this, this);
	}

	/** Lets every module hook into the root app, then mounts the controllers of each module. */
	private async serveModules(): Promise<void> {
		const { nodes } = this.kernel.graph;

		for (const node of nodes) {
			const instance = this.kernel.moduleInstance(node);
			await ModuleContext.run(node, () => instance.onServe(this.#elysia));
		}

		for (const node of nodes) {
			if (node.props.controllers?.length) {
				this.debug(`Mounting module ${node.id}...`);
				this.#elysia.use(await this.mountModule(node));
			}
		}
	}

	/** Builds the Elysia plugin of a module: its middlewares and the plugins of its controllers. */
	private async mountModule(node: ModuleNode): Promise<ElysiaApp> {
		const app: ElysiaApp = new Elysia({ name: node.id, prefix: node.props.prefix });

		const middlewares = Metadata.get(Symbols.middlewares, node.moduleClass) ?? [];
		applyMiddlewares(middlewares, app, node);

		for (const controller of node.props.controllers ?? []) {
			const plugin: ElysiaPlugin | undefined = Metadata.get(Symbols.elysiaPlugin, controller);
			if (!plugin) throw new InvalidControllerError(controller.name, node.id);
			app.use(await plugin(node));
		}

		return app;
	}

	/** Registers the error handler and the start and stop hooks of the root app. */
	private setupServerHooks(): void {
		this.#elysia
			.onError('global', (e) => this.handleServerError(e as ServerError))
			.onStart(async (elysia) => {
				await this.onStart(elysia as unknown as Elysia<Route>);
				Event.emit('elysium:server:start', elysia, this);
			})
			.onStop(async (elysia) => {
				await this.onStop(elysia as unknown as Elysia<Route>);
				Event.emit('elysium:server:stop', elysia, this);
				this.removeSignalHandlers();
				await this.#kernel?.shutdown();
				this._appContextStorage.disable();
			});
	}

	/** Turns an error raised while handling a request into the response sent to the client. */
	private async handleServerError(e: ServerError) {
		if (middlewareStops.has(e.error)) return;
		if (!(await this.onError(e))) return;

		Event.emit('elysium:error', e);
		this.trace({
			name: 'HttpError',
			message: 'Unexpected error while handling HTTP request',
			stack: e.error.stack,
			...e.error
		});

		// A thrown status is already a response.
		if (e.error instanceof ElysiaStatus) return e.error;

		// Elysia names its errors in kebab case ('not-found'); the response keeps the upper snake case
		// names ('NOT_FOUND'), with UNKNOWN for errors Elysia did not raise.
		const code = e.code ? e.code.toUpperCase().replaceAll('-', '_') : 'UNKNOWN';

		let data = {};
		switch (code) {
			case 'VALIDATION':
				data = { scope: e.error.type, code: e.error.message };
				break;
			case 'INTERNAL_SERVER_ERROR':
				data = { message: e.error.message };
				break;
		}

		return { type: code, data };
	}

	/**
	 * Describes the CLI and available commands.
	 */
	private commandDescribe() {
		this.section(
			`${this.bold('Usage:')} ${this.format('styx', ConsoleFormat.MAGENTA)} <command> [options]`
		);

		this.section(this.bold('Core Commands:'));
		this.newLine();
		this.commandDescription('serve', '', 'Starts the server.');
		this.commandDescription('help', '<command>', 'Displays help for a command.');
		this.commandDescription('list', '', 'List all available application commands.');

		this.section(this.bold('Application Commands:'));
		this.commandList();
	}

	private commandList() {
		const groups = this.getCommands().reduce((acc, { item }) => {
			const groupKey: string = first(getCommandName(item).split(':'))!;
			acc.set(groupKey, [...(acc.get(groupKey) ?? []), item]);
			return acc;
		}, new Map<string, CommandClass[]>());

		for (const [group, groupCommands] of groups) {
			this.section(this.format(group, ConsoleFormat.BLUE));
			for (const commandClass of groupCommands) {
				this.commandDescription(getCommandName(commandClass), '', commandClass.description);
			}
		}
	}

	private commandDescription(
		command: string,
		args: string,
		description: string,
		width: number = InteractsWithConsole.SPACE_WIDTH
	) {
		args = args.length === 0 ? ' ' : ` ${args} `;
		this.write(
			` ${this.format(command, ConsoleFormat.CYAN)}${args}${'∙'.repeat(width - command.length - args.length)} ${description}`
		);
	}
}
