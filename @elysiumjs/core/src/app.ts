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

import type { ElysiaSwaggerConfig } from '@elysiajs/swagger';
import type { AnyElysia, ElysiaConfig, ErrorContext, TSchema } from 'elysia';
import type { CommandClass } from './command';
import type { Route } from './http';
import type { ModuleClass } from './module';
import type { RedisConnectionProps } from './redis';
import type { WampClientProps } from './wamp';

import { AsyncLocalStorage } from 'node:async_hooks';
import { parseArgs } from 'node:util';

import { swagger as swaggerPlugin } from '@elysiajs/swagger';
import { Value } from '@sinclair/typebox/value';
import { Elysia } from 'elysia';
import { first } from 'radash';

import { ConsoleFormat, InteractsWithConsole } from './console';
import { initEnv } from './env';
import { Event } from './event';
import { applyMiddlewares } from './middleware';
import { Redis } from './redis';
import { Service } from './service';
import { deepMerge, Symbols } from './utils';
import { Wamp } from './wamp';

/**
 * An application plugin, consisting of a function that returns an Elysia instance.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type ElysiumPlugin = (app: Application) => Promise<AnyElysia>;

/**
 * Properties required when declaring an app using the `@app()` decorator.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type AppProps = {
	// Allows to pass custom options to the application properties.
	[key: string]: any;

	/**
	 * Enables or disables debug mode.
	 */
	debug?: boolean;

	/**
	 * The Elysia server configuration.
	 */
	server?: ElysiaConfig<Route> & {
		/**
		 * The port to listen on.
		 */
		port?: number;
	};

	/**
	 * The wamp client configuration for the app.
	 */
	wamp?: {
		/**
		 * The default connection name.
		 */
		default: string;

		/**
		 * The list of connections.
		 */
		connections: Record<string, WampClientProps>;
	};

	/**
	 * The list of modules provided the app.
	 */
	modules?: ModuleClass[];

	/**
	 * The redis configuration for the app.
	 */
	redis?: {
		/**
		 * The default connection name.
		 */
		default: string;

		/**
		 * The list of connections.
		 */
		connections: Record<string, RedisConnectionProps>;
	};

	/**
	 * Swagger documentation configuration.
	 *
	 * Set it to `false` to disable Swagger documentation.
	 */
	swagger?: ElysiaSwaggerConfig<Route> | false;

	/**
	 * The validation schema for the application environment.
	 */
	env?: TSchema;

	/**
	 * The list of plugins to load.
	 */
	plugins?: ElysiumPlugin[];
};

/**
 * Type for the application context.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type AppContext = AsyncLocalStorage<Map<'tenant' | 'http:context' | 'db:tx', unknown>>;

/**
 * Base class for the application main entry.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export abstract class Application extends InteractsWithConsole {
	// @ts-expect-error The property is not initialized in the constructor.
	#elysia: Elysia<Route>;
	#debug: boolean;

	private readonly _appContextStorage: AppContext = new AsyncLocalStorage();

	/**
	 * Gets the running application instance.
	 */
	public static get instance(): Application {
		return Service.get<Application>('elysium.app')!;
	}

	/**
	 * Gets the application context shared between asynchronous operations.
	 */
	public static get context(): AppContext {
		return Application.instance._appContextStorage;
	}

	/**
	 * Marks a class as the application main entry.
	 * @param props The decorator options.
	 */
	public static register(props: AppProps = {}): ClassDecorator {
		return function (target) {
			// Get metadata from the prototype chain
			let parentMetadata: AppProps | undefined;
			let proto = Object.getPrototypeOf(target);

			// Traverse up the prototype chain to find metadata
			while (proto && proto !== Object.prototype) {
				const metadata = Reflect.getMetadata(Symbols.app, proto);
				if (metadata) {
					parentMetadata = metadata;
					break;
				}
				proto = Object.getPrototypeOf(proto);
			}

			// Merge with parent metadata if found, then with current metadata
			if (parentMetadata) {
				props = deepMerge<AppProps>(parentMetadata, props);
			}

			// Merge with existing metadata on the current class (if any)
			const currentMetadata = Reflect.getMetadata(Symbols.app, target);
			if (currentMetadata) {
				props = deepMerge<AppProps>(currentMetadata, props);
			}

			// Default props
			props = deepMerge<AppProps>({ modules: [], swagger: false }, props);

			// Store the merged metadata
			Reflect.defineMetadata(Symbols.app, props, target);
		};
	}

	/**
	 * Creates a new instance of the application.
	 */
	public constructor() {
		super();

		const { env, debug }: AppProps = Reflect.getMetadata(Symbols.app, this.constructor) ?? {};
		this.#debug = debug ?? false;

		if (env) {
			const rawEnv = Value.Convert(env, Value.Clone(Bun.env));

			if (this.#debug && !Value.Check(env, rawEnv)) {
				const error = Value.Errors(env, rawEnv).First();
				this.trace(error! as unknown as Error, 'Invalid environment configuration');
			}

			initEnv(Value.Clean(env, rawEnv) as Record<string, unknown>);
		} else {
			initEnv(Bun.env);
		}

		Service.instance('elysium.app', this);

		const { redis, wamp } = Reflect.getMetadata(Symbols.app, this.constructor) as AppProps;

		if (redis) {
			for (const connectionName in redis.connections) {
				Redis.registerConnection(connectionName, redis.connections[connectionName]);
			}

			if (Redis.connectionExists(redis.default)) {
				Redis.setDefaultConnection(redis.default);
			}
		}

		if (wamp) {
			for (const connectionName in wamp.connections) {
				Wamp.registerConnection(connectionName, wamp.connections[connectionName]);
			}

			if (Wamp.connectionExists(wamp.default)) {
				Wamp.setDefaultConnection(wamp.default);
			}
		}

		// Run the application
		this.run()
			.then(() => Event.emit('elysium:app:launched', this, this))
			.catch((error) => {
				Event.emit('elysium:error', error);
				this.trace(error, 'An error occurred while launching the application');
				process.exit(1);
			});
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
	protected async onError(_error: ErrorContext): Promise<boolean> {
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

	protected async run(): Promise<void> {
		const argv = process.argv.slice(2);

		const action = argv[0];

		if (!action) {
			this.commandDescribe();
		} else {
			switch (action) {
				case 'serve': {
					return this.commandServe();
				}
				case 'work': {
					return this.commandWork(argv.slice(1));
				}
				case 'help': {
					const command = argv[1];

					if (command) {
						const commands = this.getCommands();
						const commandClass = commands.find((commandClass) => commandClass.command === command);

						if (commandClass) {
							const commandInstance = Service.make(commandClass);
							this.write(await commandInstance.help());
							return process.exit(0);
						}

						console.error(`Command <${command}> not found.`);
					} else {
						console.error('No command provided. Usage: styx help <command>');
					}

					this.commandList();
					break;
				}
				case 'list': {
					this.write(this.bold('Available commands:'));
					this.commandList();
					break;
				}
				default: {
					const args = argv.slice(1);

					return this.commandExec(action, args);
				}
			}
		}

		return process.exit(0);
	}

	/**
	 * Retrieves the configuration value for the given key.
	 * @param key The key to retrieve the configuration value for.
	 * @returns The configuration value for the given key, or `null` if not found.
	 */
	public getConfig<T>(key: keyof AppProps): T | null {
		return Reflect.getMetadata(Symbols.app, this.constructor)?.[key] ?? null;
	}

	/**
	 * Executes a command.
	 * @param command The command to execute.
	 * @param argv The command line arguments.
	 */
	private async commandExec(command: string, argv: string[]): Promise<void> {
		const commands = this.getCommands();

		// Find the command class
		const commandClass = commands.find((commandClass) => commandClass.command === command);

		if (!commandClass) {
			console.error(`Command ${command} not found`);
			this.commandList();
			return process.exit(1);
		}

		try {
			// Create the command instance
			const commandInstance = Service.make(commandClass);

			// Run the command
			const initialized = await commandInstance.init(...argv);

			if (initialized) {
				await commandInstance.run();
			} else {
				const help = await commandInstance.help();
				this.write(help);
			}

			return process.exit(0);
		} catch (error: any) {
			console.error(error.message);
			return process.exit(1);
		}
	}

	/**
	 * Discovers all registered commands from the service container.
	 * Commands are registered via `@Command.register()` and stored with the
	 * `elysium.command.*` service name pattern.
	 *
	 * @returns An array of all discovered command classes, filtered by build mode.
	 */
	private getCommands(): CommandClass[] {
		const commandKeys = Service.keys('elysium.command.*');
		const commands = commandKeys
			.map((key) => Service.get<CommandClass>(key))
			.filter((cmd): cmd is CommandClass => cmd !== null);

		return commands.filter((cmd) => (Bun.env.NODE_ENV === 'production' ? !cmd.dev : true));
	}

	private async commandWork(argv: string[]) {
		this.info('Starting worker process...');

		// Parse queue arguments
		const { values } = parseArgs({
			args: argv,
			options: {
				queue: {
					type: 'string',
					multiple: true,
					default: ['default'],
					short: 'q'
				},
				concurrency: {
					type: 'string',
					default: '1',
					short: 'c'
				},
				['max-retries']: {
					type: 'string',
					default: '5',
					short: 'r'
				},
				['retry-delay']: {
					type: 'string',
					default: '5000',
					short: 'd'
				},
				['pause-on-error']: {
					type: 'boolean',
					default: false,
					short: 'p'
				}
			}
		});

		// Import worker-specific code
		const { Worker } = await import('./worker');

		// Start the worker with the specified queues
		const queues = values.queue
			.map((queue) => queue.split(','))
			.reduce((acc, queues) => acc.concat(queues), []);

		const worker = Worker.spawn(self as unknown as globalThis.Worker, queues, {
			concurrency: parseInt(values.concurrency, 10),
			maxRetries: parseInt(values['max-retries'], 10),
			retryDelay: parseInt(values['retry-delay'], 10),
			pauseOnError: values['pause-on-error']
		});

		this.success(
			`Worker process ${this.format(worker.id, ConsoleFormat.GREEN)} started with queues: ${queues.map((q) => this.format(q, ConsoleFormat.CYAN)).join(', ')}`
		);
	}

	/**
	 * Starts the server on the specified port.
	 */
	private async commandServe(): Promise<void> {
		const { server, modules, swagger, plugins } = Reflect.getMetadata(
			Symbols.app,
			this.constructor
		) as AppProps;

		this.#elysia = new Elysia(server).onRequest((c) => {
			if (this.isDebug) {
				// TODO: Use the logger service here
				console.log(c.request.method, c.request.url);
			}
		});

		Event.emit('elysium:server:before-init', this, this);

		this.#elysia.resolve({ as: 'global' }, ({ request }) => ({
			tenant: request.headers.get('x-tenant-id') ?? 'public'
		}));

		if (swagger) {
			this.#elysia.use(swaggerPlugin(swagger));
		}

		if (plugins && plugins.length > 0) {
			this.debug('Registering plugins...');
			for (const plugin of plugins) {
				this.#elysia.use(await plugin(this));
			}
		}

		this.#elysia
			.onError({ as: 'global' }, async (e) => {
				if (await this.onError(e)) {
					Event.emit('elysium:error', e);
					this.trace({
						name: 'HttpError',
						message: 'Unexpected error while handling HTTP request',
						// @ts-expect-error The stack property may not exist in the error.
						stack: e.error.stack,
						...e.error
					});

					let data = {};

					if (typeof e.code === 'number') {
						return e.error.response;
					} else {
						switch (e.code) {
							case 'VALIDATION': {
								data = {
									scope: e.error.type,
									code: e.error.message
								};
								break;
							}
							case 'INTERNAL_SERVER_ERROR': {
								data = {
									message: e.error.message
								};
								break;
							}
						}
					}

					return {
						type: e.code,
						data
					};
				}
			})
			.onStart(async (elysia) => {
				await this.onStart(elysia as unknown as Elysia<Route>);
				Event.emit('elysium:server:start', elysia, this);
			})
			.onStop(async (elysia) => {
				await this.onStop(elysia as unknown as Elysia<Route>);
				Event.emit('elysium:server:stop', elysia, this);
				this._appContextStorage.disable();
			});

		const middlewares = Reflect.getMetadata(Symbols.middlewares, this.constructor) ?? [];
		applyMiddlewares(middlewares, this.#elysia);

		for (const moduleClass of modules!) {
			const plugin = Reflect.getMetadata(Symbols.elysiaPlugin, moduleClass);
			if (plugin === undefined) {
				// TODO: Use the logger service here
				console.error(
					`Invalid module class ${moduleClass.name} registered in app ${this.constructor.name}. Ensure that you used the @module() decorator on the module.`
				);
				return process.exit(1);
			}

			const module = Service.bind(moduleClass);

			this.#elysia.use(await plugin(module));
		}

		Event.emit('elysium:server:after-init', this, this);

		// Register the server
		this.#elysia.listen(server?.port ?? (parseInt(process.env.PORT!, 10) || 3000));

		process.on('SIGINT', () => {
			this.#elysia.stop().then(() => process.exit(0));
		});
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
		const commands = this.getCommands();

		const groups = commands.reduce((acc, commandClass) => {
			const groupKey: string = first(commandClass.command.split(':'))!;
			const group = acc.get(groupKey) ?? [];
			group.push(commandClass);
			acc.set(groupKey, group);
			return acc;
		}, new Map<string, CommandClass[]>());

		for (const [group, groupCommands] of groups) {
			this.section(this.format(group, ConsoleFormat.BLUE));
			for (const commandClass of groupCommands) {
				this.commandDescription(commandClass.command, '', commandClass.description);
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
