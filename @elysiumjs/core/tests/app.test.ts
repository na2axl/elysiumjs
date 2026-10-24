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

import type { ValueError } from '@sinclair/typebox/value';
import type { AppContext } from '../src/app';

import { AsyncLocalStorage } from 'node:async_hooks';

import { Value } from '@sinclair/typebox/value';
import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import { t } from 'elysia';

import { Application } from '../src/app';
import { Command } from '../src/command';
import { Container } from '../src/container';
import * as Env from '../src/env';
import { Event } from '../src/event';
import { Middleware } from '../src/middleware';
import { Module } from '../src/module';
import { ModuleContext } from '../src/module-context';
import { Service } from '../src/service';
import { nextTick, Symbols } from '../src/utils';

const resetContainer = () => {
	Container.reset();
	Container.setVisibility(null);
	Container.setModuleInitHook(null);
	Container.setSkippedLookup(null);
};

// Test @Application.register decorator
describe('@Application.register decorator', () => {
	it('should set metadata on the target class', () => {
		@Application.register({
			debug: true,
			modules: []
		})
		class TestApp extends Application {}

		const metadata = Reflect.getMetadata(Symbols.app, TestApp);
		expect(metadata).toBeDefined();
		expect(metadata.debug).toBe(true);
		expect(metadata.modules).toBeArrayOfSize(0);
	});
});

// Test Application class
describe('Application class', () => {
	const originalExit = process.exit;
	const originalStdoutWrite = process.stdout.write;
	const originalStderrWrite = process.stderr.write;

	let output = '';
	let errors = '';

	const signalListeners = { SIGINT: [] as Function[], SIGTERM: [] as Function[] };
	const servers: { stop(force?: boolean): Promise<unknown> }[] = [];

	/** Runs the serve action and records the server so it is stopped after the test. */
	const serve = async (app: Application) => {
		await app.run(['serve']);
		servers.push(app.elysia);
	};

	beforeEach(() => {
		signalListeners.SIGINT = process.listeners('SIGINT');
		signalListeners.SIGTERM = process.listeners('SIGTERM');
		process.exit = mock() as any;
		mock.restore();

		process.stdout.write = mock((message) => {
			output += message;
			return true;
		});
		process.stderr.write = mock((message) => {
			errors += message;
			return true;
		});
	});

	afterEach(async () => {
		for (const signal of ['SIGINT', 'SIGTERM'] as const) {
			for (const listener of process.listeners(signal)) {
				if (!signalListeners[signal].includes(listener)) process.off(signal, listener);
			}
		}
		for (const server of servers.splice(0)) {
			try {
				await server.stop(true);
			} catch {
				// Already stopped by the test.
			}
		}

		Event.off('elysium:app:launched');
		process.exit = originalExit;
		process.stdout.write = originalStdoutWrite;
		process.stderr.write = originalStderrWrite;

		Service.clear();
		resetContainer();
		output = '';
		errors = '';
	});

	describe('constructor', () => {
		it('should register the application instance in the service container', () => {
			const instanceSpy = spyOn(Service, 'instance');

			@Application.register({ debug: true })
			class TestApp extends Application {}

			new TestApp();

			expect(instanceSpy).toHaveBeenCalledWith('elysium.app', expect.any(TestApp));
		});

		it('should replace a previously registered application instance', () => {
			@Application.register()
			class TestApp extends Application {}

			const first = new TestApp();
			const second = new TestApp();

			expect(first).not.toBe(second);
			expect(Application.instance).toBe(second);
		});

		it('should not run the application', () => {
			const runSpy = spyOn(Application.prototype, 'run');

			@Application.register()
			class TestApp extends Application {}

			new TestApp();

			expect(runSpy).not.toHaveBeenCalled();
		});

		it('should set debug mode from app props', () => {
			@Application.register({ debug: true })
			class TestApp extends Application {}

			expect(new TestApp().isDebug).toBe(true);
		});

		it('should handle the case when no environment configuration is provided', () => {
			const initEnvSpy = spyOn(Env, 'initEnv');

			@Application.register()
			class TestApp extends Application {}

			new TestApp();

			expect(initEnvSpy).toHaveBeenCalledWith(Bun.env);
		});

		it('should validate and handle invalid environment configuration when debug is enabled', () => {
			const traceSpy = spyOn(Application.prototype, 'trace');
			const errorFirstMock: ValueError = {
				type: 43,
				path: '/TEST_VAR',
				message: 'Expected string',
				errors: [],
				value: {},
				schema: t.Object({ TEST_VAR: t.String() })
			};
			const valueCheckSpy = spyOn(Value, 'Check').mockReturnValueOnce(false);
			// @ts-expect-error The type is incorrect
			const valueErrorsSpy = spyOn(Value, 'Errors').mockReturnValueOnce({
				First: () => errorFirstMock
			});
			spyOn(Value, 'Convert').mockReturnValueOnce({});
			const valueCleanSpy = spyOn(Value, 'Clean').mockReturnValueOnce({});
			const initEnvSpy = spyOn(Env, 'initEnv');

			@Application.register({ debug: true, env: errorFirstMock.schema })
			class TestApp extends Application {}

			new TestApp();

			expect(valueCheckSpy).toHaveBeenCalled();
			expect(valueErrorsSpy).toHaveBeenCalled();
			expect(traceSpy).toHaveBeenCalledWith(errorFirstMock, 'Invalid environment configuration');
			expect(valueCleanSpy).toHaveBeenCalled();
			expect(initEnvSpy).toHaveBeenCalledWith({});
		});

		it('should properly initialize environment with Value.Clean result when env is provided', () => {
			const valueCloneSpy = spyOn(Value, 'Clone').mockReturnValueOnce({ TEST_VAR: 'test_value' });
			const valueConvertSpy = spyOn(Value, 'Convert').mockReturnValueOnce({
				TEST_VAR: 'test_value'
			});
			spyOn(Value, 'Check').mockReturnValueOnce(true);
			const valueCleanSpy = spyOn(Value, 'Clean').mockReturnValueOnce({
				TEST_VAR: 'cleaned_value'
			});
			const initEnvSpy = spyOn(Env, 'initEnv');

			const envSchema = t.Object({ TEST_VAR: t.String() });

			@Application.register({ env: envSchema })
			class TestApp extends Application {}

			new TestApp();

			expect(valueCloneSpy).toHaveBeenCalledWith(Bun.env);
			expect(valueConvertSpy).toHaveBeenCalledWith(envSchema, { TEST_VAR: 'test_value' });
			expect(valueCleanSpy).toHaveBeenCalled();
			expect(initEnvSpy).toHaveBeenCalledWith({ TEST_VAR: 'cleaned_value' });
		});
	});

	describe('static methods', () => {
		it('should return the application instance', () => {
			const testInstance = {};
			const getSpy = spyOn(Service, 'get').mockReturnValueOnce(testInstance);

			const instance = Application.instance;

			expect(getSpy).toHaveBeenCalledWith('elysium.app');
			expect(instance).toBe(testInstance as Application);
		});

		it('should return the application context', () => {
			const mockContext: AppContext = new AsyncLocalStorage();
			const mockInstance = { _appContextStorage: mockContext };

			const originalDescriptor = Object.getOwnPropertyDescriptor(Application, 'instance');
			Object.defineProperty(Application, 'instance', { get: () => mockInstance });

			expect(Application.instance).toBe(mockInstance as unknown as Application);
			expect(Application.context).toBe(mockContext);

			if (originalDescriptor) {
				Object.defineProperty(Application, 'instance', originalDescriptor);
			}
		});

		it('should boot a module graph with testing()', async () => {
			class Greeter {}

			@Module.register({ services: [Greeter], exports: [Greeter] })
			class GreeterModule extends Module {}

			const app = await Application.testing({ modules: [GreeterModule] });
			expect(await app.get(Greeter, GreeterModule)).toBeInstanceOf(Greeter);
			expect(app.kernel.graph.environment).toBe('test');
			await app.shutdown();
		});

		it('should run a new instance with start()', async () => {
			const runSpy = spyOn(Application.prototype, 'run').mockResolvedValue(undefined);

			@Application.register()
			class TestApp extends Application {}

			await TestApp.start();

			expect(runSpy).toHaveBeenCalledTimes(1);
		});
	});

	describe('getters and setters', () => {
		it('should get and set debug mode', () => {
			@Application.register({ debug: false })
			class TestApp extends Application {}

			const instance = new TestApp();
			expect(instance.isDebug).toBe(false);

			instance.isDebug = true;
			expect(instance.isDebug).toBe(true);
		});

		it('should get the Elysia instance', async () => {
			@Application.register()
			class TestApp extends Application {}

			const instance = new TestApp();
			await serve(instance);

			expect(instance.elysia).toBeDefined();
		});

		it('should expose the kernel once the application has run', async () => {
			@Application.register()
			class TestApp extends Application {}

			const instance = new TestApp();
			expect(() => instance.kernel).toThrow();

			await instance.run(['list']);
			expect(instance.kernel.graph.nodes).toHaveLength(0);
		});
	});

	describe('CLI', () => {
		const events: string[] = [];

		beforeEach(() => {
			events.length = 0;
		});

		/** Builds a command that records its lifecycle and reads a module-private service. */
		const makeCommand = (name: string, options: { boot?: boolean } = {}) => {
			class PrivateService {
				public value = 'secret';
			}

			class TestCommand extends Command {
				public static readonly command = name;
				public static readonly description = `The ${name} command`;
				public static readonly boot = options.boot ?? false;

				public async run() {
					events.push(`run:${name}:${Service.get<PrivateService>(PrivateService)?.value}`);
				}

				public async help() {
					return `help for ${name}`;
				}
			}

			return { TestCommand, PrivateService };
		};

		const appWith = (...modules: any[]) => {
			@Application.register({ modules })
			class TestApp extends Application {}
			return new TestApp();
		};

		it('should leave the container untouched when a command is registered', () => {
			const before = Container.globalNames();

			@Command.register()
			class Registered extends Command {
				public static readonly command = 'reg:one';
				public async run() {}
			}

			expect(Container.globalNames()).toEqual(before);
			expect(Reflect.getMetadata(Symbols.command, Registered)).toEqual({});
		});

		it('should run a module command that sees a module-private service', async () => {
			const { TestCommand, PrivateService } = makeCommand('demo:run');

			@Module.register({ services: [PrivateService], commands: [TestCommand] })
			class DemoModule extends Module {}

			await appWith(DemoModule).run(['demo:run']);

			expect(events).toEqual(['run:demo:run:secret']);
			expect(process.exit).toHaveBeenCalledWith(0);
		});

		it('should pass the remaining arguments to the command', async () => {
			const received: string[][] = [];

			class ArgsCommand extends Command {
				public static readonly command = 'args:cmd';
				public async init(...argv: string[]) {
					received.push(argv);
					return true;
				}
				public async run() {}
			}

			@Module.register({ commands: [ArgsCommand] })
			class ArgsModule extends Module {}

			await appWith(ArgsModule).run(['args:cmd', 'a', 'b']);

			expect(received).toEqual([['a', 'b']]);
		});

		it('should resolve a command named through @Command.register({ name })', async () => {
			@Command.register({ name: 'renamed:cmd' })
			class Original extends Command {
				public static readonly command = 'original:cmd';
				public async run() {
					events.push('renamed ran');
				}
			}

			@Module.register({ commands: [Original] })
			class RenamedModule extends Module {}

			await appWith(RenamedModule).run(['renamed:cmd']);

			expect(events).toEqual(['renamed ran']);
		});

		it('should report a command that is not in any module and exit 1', async () => {
			const { TestCommand } = makeCommand('orphan');
			void TestCommand;

			await appWith().run(['orphan']);

			expect(errors).toContain('Command orphan not found');
			expect(process.exit).toHaveBeenCalledWith(1);
		});

		it('should list commands without constructing any service', async () => {
			const { TestCommand, PrivateService } = makeCommand('list:one');
			const constructed = mock();
			class Spied extends PrivateService {
				constructor() {
					super();
					constructed();
				}
			}

			@Module.register({ services: [Spied], commands: [TestCommand] })
			class ListModule extends Module {
				constructor() {
					super();
					constructed();
				}
			}

			await appWith(ListModule).run(['list']);

			expect(output).toContain('list:one');
			expect(output).toContain('The list:one command');
			expect(constructed).not.toHaveBeenCalled();
			expect(process.exit).toHaveBeenCalledWith(0);
		});

		it('should describe the CLI when no action is given', async () => {
			const { TestCommand } = makeCommand('describe:one');

			@Module.register({ commands: [TestCommand] })
			class DescribeModule extends Module {}

			await appWith(DescribeModule).run([]);

			expect(output).toContain('Usage:');
			expect(output).toContain('describe:one');
			expect(process.exit).toHaveBeenCalledWith(0);
		});

		it('should print the help of a command', async () => {
			const { TestCommand, PrivateService } = makeCommand('help:cmd');

			@Module.register({ services: [PrivateService], commands: [TestCommand] })
			class HelpModule extends Module {}

			await appWith(HelpModule).run(['help', 'help:cmd']);

			expect(output).toContain('help for help:cmd');
			expect(process.exit).toHaveBeenCalledWith(0);
		});

		it('should fail the help of an unknown command', async () => {
			await appWith().run(['help', 'nope']);

			expect(errors).toContain('Command <nope> not found.');
			expect(process.exit).toHaveBeenCalledWith(1);
		});

		it('should not initialise an unrelated sibling module for a lazy command', async () => {
			const initialised: string[] = [];

			@Module.register({})
			class SiblingModule extends Module {
				public async onInit() {
					initialised.push('sibling');
				}
			}

			const lazy = makeCommand('lazy:only');

			@Module.register({ services: [lazy.PrivateService], commands: [lazy.TestCommand] })
			class LazyModule extends Module {
				public async onInit() {
					initialised.push('lazy');
				}
			}

			await appWith(SiblingModule, LazyModule).run(['lazy:only']);

			expect(initialised).toEqual(['lazy']);
		});

		it('should initialise every module for a command with boot = true', async () => {
			const initialised: string[] = [];

			@Module.register({})
			class SiblingModule extends Module {
				public async onInit() {
					initialised.push('sibling');
				}
			}

			const eager = makeCommand('eager:only', { boot: true });

			@Module.register({ services: [eager.PrivateService], commands: [eager.TestCommand] })
			class EagerModule extends Module {
				public async onInit() {
					initialised.push('eager');
				}
			}

			await appWith(SiblingModule, EagerModule).run(['eager:only']);

			expect(initialised.sort()).toEqual(['eager', 'sibling']);
			expect(events).toEqual(['run:eager:only:secret']);
		});

		it('should run init, run and help inside the owning module context', async () => {
			const seen: (string | undefined)[] = [];

			class ContextCommand extends Command {
				public static readonly command = 'ctx:cmd';
				public async init() {
					seen.push(ModuleContext.current()?.id);
					return true;
				}
				public async run() {
					seen.push(ModuleContext.current()?.id);
				}
			}

			@Module.register({ commands: [ContextCommand] })
			class ContextModule extends Module {}

			await appWith(ContextModule).run(['ctx:cmd']);

			expect(seen).toEqual(['ContextModule', 'ContextModule']);
		});

		it('should emit app:launched once for a lazy command, before it runs', async () => {
			const { TestCommand, PrivateService } = makeCommand('launch:lazy');
			const launched = mock(() => events.push('launched'));
			Event.on('elysium:app:launched', launched);

			@Module.register({ services: [PrivateService], commands: [TestCommand] })
			class LaunchModule extends Module {}

			await appWith(LaunchModule).run(['launch:lazy']);

			expect(launched).toHaveBeenCalledTimes(1);
			expect(events).toEqual(['launched', 'run:launch:lazy:secret']);
		});

		it('should emit app:launched once for a boot command, after the eager boot', async () => {
			const { TestCommand, PrivateService } = makeCommand('launch:boot', { boot: true });
			const launched = mock(() => events.push('launched'));
			Event.on('elysium:app:launched', launched);

			@Module.register({ services: [PrivateService], commands: [TestCommand] })
			class BootModule extends Module {
				public async onInit() {
					events.push('init');
				}
			}

			await appWith(BootModule).run(['launch:boot']);

			expect(launched).toHaveBeenCalledTimes(1);
			expect(events).toEqual(['init', 'launched', 'run:launch:boot:secret']);
		});

		it('should not emit app:launched for list', async () => {
			const launched = mock();
			Event.on('elysium:app:launched', launched);

			await appWith().run(['list']);

			expect(launched).not.toHaveBeenCalled();
		});

		it('should detach its signal handlers when the server stops', async () => {
			@Application.register({ server: { port: 0 } })
			class TestApp extends Application {}

			const before = process.listeners('SIGINT').length;
			const instance = new TestApp();
			await serve(instance);
			expect(process.listeners('SIGINT')).toHaveLength(before + 1);

			await instance.elysia.stop();
			expect(process.listeners('SIGINT')).toHaveLength(before);
			expect(process.listeners('SIGTERM')).toHaveLength(signalListeners.SIGTERM.length);
		});

		it('should print an ElysiumError raised in the graph phase and exit 1', async () => {
			@Module.register({})
			class BrokenModule extends Module {}
			// A class without @Module.register is rejected while the graph is built.
			class NotAModule extends Module {}

			await appWith(BrokenModule, NotAModule).run(['list']);

			expect(errors).toContain('NotAModule');
			expect(process.exit).toHaveBeenCalledWith(1);
		});

		it('should print other errors and exit 1', async () => {
			class FailingCommand extends Command {
				public static readonly command = 'fail:cmd';
				public async run() {
					throw new Error('boom');
				}
			}

			@Module.register({ commands: [FailingCommand] })
			class FailingModule extends Module {}

			await appWith(FailingModule).run(['fail:cmd']);

			expect(errors).toContain('boom');
			expect(process.exit).toHaveBeenCalledWith(1);
		});

		it('should shut down after a command completes', async () => {
			const destroyed: string[] = [];

			const { TestCommand, PrivateService } = makeCommand('down:cmd');

			@Module.register({ services: [PrivateService], commands: [TestCommand] })
			class DownModule extends Module {
				public async onDestroy() {
					destroyed.push('module');
				}
			}

			await appWith(DownModule).run(['down:cmd']);

			expect(destroyed).toEqual(['module']);
		});

		it('should install signal handlers that shut down and exit 0', async () => {
			const { TestCommand } = makeCommand('sig:cmd');
			let release!: () => void;

			class SlowCommand extends TestCommand {
				public static readonly command = 'sig:cmd';
				public async run() {
					await new Promise<void>((resolve) => (release = resolve));
				}
			}

			@Module.register({ commands: [SlowCommand] })
			class SigModule extends Module {}

			const app = appWith(SigModule);
			const running = app.run(['sig:cmd']);
			await nextTick();
			await nextTick();

			const shutdownSpy = spyOn(app.kernel, 'shutdown');
			process.emit('SIGTERM');
			await nextTick();
			await nextTick();

			expect(shutdownSpy).toHaveBeenCalled();
			expect(process.exit).toHaveBeenCalledWith(0);

			release();
			await running;
		});
	});

	// The serve tests below are rewritten with the serve rework.
	describe('serve', () => {
		it('should handle the serve command', async () => {
			@Application.register({ server: { port: 3131 }, modules: [], swagger: false })
			class TestApp extends Application {}

			Event.on('elysium:server:after-init', async (e) => {
				spyOn(e.source.elysia, 'listen');
			});

			const instance = new TestApp();
			await serve(instance);

			expect(instance.elysia.listen).toHaveBeenCalledWith(3131);
		});
	});

	describe('lifecycle hooks', () => {
		it('should call onStart when the server starts', async () => {
			@Application.register()
			class TestApp extends Application {
				protected async onStart(): Promise<void> {}
			}

			// @ts-expect-error The onStart method is protected
			const onStartSpy = spyOn(TestApp.prototype, 'onStart');
			const emitSpy = spyOn(Event, 'emit');

			const instance = new TestApp();
			await serve(instance);
			await nextTick();

			expect(onStartSpy).toHaveBeenCalledWith(instance.elysia);
			expect(emitSpy).toHaveBeenLastCalledWith('elysium:server:start', instance.elysia, instance);
		});

		it('should call onStop when the server stops', async () => {
			@Application.register()
			class TestApp extends Application {
				protected async onStop(): Promise<void> {}
			}

			// @ts-expect-error The onStop method is protected
			const onStopSpy = spyOn(TestApp.prototype, 'onStop');
			const emitSpy = spyOn(Event, 'emit');

			const instance = new TestApp();
			await serve(instance);

			await nextTick();
			process.emit('SIGINT');
			await nextTick();
			await nextTick();

			expect(onStopSpy).toHaveBeenCalledWith(instance.elysia);
			expect(emitSpy).toHaveBeenCalledWith('elysium:server:stop', instance.elysia, instance);
		});

		it('should call onError when an error occurs', async () => {
			@Application.register()
			class TestApp extends Application {
				protected async onError(): Promise<boolean> {
					return true;
				}
			}

			// @ts-expect-error The onError method is protected
			const onErrorSpy = spyOn(TestApp.prototype, 'onError');
			const emitSpy = spyOn(Event, 'emit');

			const instance = new TestApp();
			await serve(instance);

			instance.elysia.get('/', ({ error }) => {
				throw error(500, 'Test error');
			});
			instance.elysia.listen(3131);

			const response = await instance.elysia.handle(new Request('http://localhost:3131/'));
			await nextTick();

			expect(response.status).toBe(500);
			expect(response.json()).toEqual(
				expect.resolvesTo.objectContaining({
					type: 'INTERNAL_SERVER_ERROR',
					data: { message: 'Test error' }
				})
			);

			expect(onErrorSpy).toHaveBeenCalledWith(expect.anything());
			expect(emitSpy).toHaveBeenCalledWith('elysium:error', expect.anything());
		});
	});

	describe('middleware application', () => {
		it('should apply middlewares correctly', async () => {
			const mi = await import('../src/middleware');
			const applyMiddlewaresSpy = spyOn(mi, 'applyMiddlewares');

			class Middleware1 extends Middleware {}
			class Middleware2 extends Middleware {}
			const mockMiddlewares = [Middleware1, Middleware2];

			@Application.register()
			class TestApp extends Application {}

			Reflect.defineMetadata(Symbols.middlewares, mockMiddlewares, TestApp);

			const instance = new TestApp();
			await serve(instance);

			expect(applyMiddlewaresSpy).toHaveBeenCalledWith(mockMiddlewares, instance.elysia);
		});
	});
});
