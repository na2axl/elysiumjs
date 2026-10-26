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

import type { Mock } from 'bun:test';
import type { ValueError } from '@sinclair/typebox/value';
import type { AppContext } from '../src/app';

import { AsyncLocalStorage } from 'node:async_hooks';

import { Value } from '@sinclair/typebox/value';
import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import { Elysia, t } from 'elysia';

import { Application } from '../src/app';
import { Command } from '../src/command';
import { Container } from '../src/container';
import * as Env from '../src/env';
import { Event } from '../src/event';
import { Http } from '../src/http';
import { Kernel } from '../src/kernel';
import { ConsoleLogger, LOGGER_SERVICE } from '../src/logger';
import { Metadata } from '../src/metadata';
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

		const metadata = Metadata.get(Symbols.app, TestApp);
		expect(metadata).toBeDefined();
		expect(metadata.debug).toBe(true);
		expect(metadata.modules).toBeArrayOfSize(0);
	});
});

describe('@Application.register merging', () => {
	const makeModules = () => {
		@Module.register()
		class A extends Module.configurable<{ a: number }>() {}
		@Module.register()
		class B extends Module.configurable<{ b: number }>() {}
		@Module.register()
		class C extends Module {}
		return { A, B, C };
	};

	it('should keep openapi props and apply the defaults when keys are omitted', () => {
		@Application.register({ openapi: { path: '/docs' } })
		class WithOpenapi extends Application {}
		@Application.register({ openapi: true as any })
		class WithTrue extends Application {}
		@Application.register()
		class Bare extends Application {}

		expect(Metadata.get(Symbols.app, WithOpenapi).openapi).toEqual({ path: '/docs' });
		expect(Metadata.get(Symbols.app, WithTrue).openapi).toBe(true);
		const bare = Metadata.get(Symbols.app, Bare);
		expect(bare.openapi).toBe(false);
		expect(bare.modules).toEqual([]);
	});

	it('should let a subclass override scalar and object props of its parent', () => {
		@Application.register({ debug: false, server: { name: 'parent', port: 1 }, openapi: false })
		class Parent extends Application {}

		@Application.register({ debug: true, server: { port: 2 }, openapi: { path: '/d' } })
		class Child extends Parent {}

		const meta = Metadata.get(Symbols.app, Child);
		expect(meta.debug).toBe(true);
		expect(meta.server).toEqual({ name: 'parent', port: 2 });
		expect(meta.openapi).toEqual({ path: '/d' });
		expect(Metadata.get(Symbols.app, Parent).debug).toBe(false);
	});

	it('should concatenate modules, parent first, leaving configs intact', () => {
		const { A, B, C } = makeModules();
		const a = A.with({ a: 10 });
		const b = B.with({ b: 20 });

		@Application.register({ modules: [a] })
		class Parent extends Application {}

		@Application.register({ modules: [b, C] })
		class Child extends Parent {}

		const modules = Metadata.get(Symbols.app, Child).modules;
		expect(modules).toEqual([a, b, C]);
		expect(modules[0]).toBe(a);
		expect(modules[1].config).toEqual({ b: 20 });
		expect(modules[0].config).toEqual({ a: 10 });
	});

	it('should not merge the parent twice when the subclass has no own metadata', () => {
		const { A } = makeModules();

		@Application.register({ modules: [A.with({ a: 1 })] })
		class Parent extends Application {}

		@Application.register()
		class Child extends Parent {}

		class Plain extends Parent {}

		expect(Metadata.get(Symbols.app, Child).modules).toHaveLength(1);
		expect(Metadata.get(Symbols.app, Plain).modules).toHaveLength(1);
	});
});

describe('Application.context', () => {
	it('falls back to a shared storage when no application instance exists', () => {
		Container.reset();
		const context = Application.context;
		expect(context).toBeDefined();
		expect(Application.context).toBe(context);
		const store = new Map<any, unknown>([['tenant', 'a']]);
		expect(context.run(store, () => Application.context.getStore())).toBe(store);
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

	/** Lets the after-response hooks of a handled request finish before the test is cleaned up. */
	const afterResponseQueue: (() => void)[] = [];
	const afterResponses: Promise<void>[] = [];

	/** A module middleware that reports when the after-response hooks of a request have run. */
	class AfterResponseProbe extends Middleware {
		public onAfterResponse() {
			afterResponseQueue.shift()?.();
		}
	}

	/** Handles a request, and tracks its after-response hooks so cleanup can wait for them. */
	const request = (app: Application, url: string) => {
		afterResponses.push(new Promise<void>((resolve) => afterResponseQueue.push(resolve)));
		return app.elysia.handle(new Request(url));
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
		await Promise.all(afterResponses.splice(0));
		afterResponseQueue.length = 0;
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
		Event.off('elysium:server:before-init');
		Event.off('elysium:server:after-init');
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
			expect(Metadata.get(Symbols.command, Registered)).toEqual({});
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

		it('should let a lazy command call sync helpers on a module it does not import', async () => {
			const seen: unknown[] = [];

			@Module.register({
				services: [{ name: 'infra.conn', global: true, factory: () => ({ conn: true }) }]
			})
			class InfraModule extends Module {
				public onInit() {}
			}

			class SyncHelperCommand extends Command {
				public static readonly command = 'sync:helper';
				public async run() {
					seen.push(Service.get('infra.conn'));
				}
			}

			@Module.register({ commands: [SyncHelperCommand] })
			class CliModule extends Module {}

			await appWith(InfraModule, CliModule).run(['sync:helper']);

			expect(seen).toEqual([{ conn: true }]);
			expect(process.exit).toHaveBeenCalledWith(0);
		});

		it('should name the module and the remedies when a sync get hits an async-init owner', async () => {
			const messages: string[] = [];

			@Module.register({
				services: [{ name: 'slow.conn', global: true, factory: () => ({ conn: true }) }]
			})
			class SlowInfraModule extends Module {
				public async onInit() {
					await nextTick();
				}
			}

			class SlowHelperCommand extends Command {
				public static readonly command = 'slow:helper';
				public async run() {
					try {
						Service.get('slow.conn');
					} catch (e) {
						messages.push((e as Error).constructor.name, (e as Error).message);
					}
					messages.push(String(await Service.resolve('slow.conn').then(() => 'resolved')));
				}
			}

			@Module.register({ commands: [SlowHelperCommand] })
			class SlowCliModule extends Module {}

			await appWith(SlowInfraModule, SlowCliModule).run(['slow:helper']);

			expect(messages[0]).toBe('ServiceNotReadyError');
			expect(messages[1]).toContain('SlowInfraModule');
			expect(messages[1]).toContain('static boot = true');
			expect(messages[1]).toContain('Service.resolve');
			expect(messages[2]).toBe('resolved');
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

	describe('help and shutdown robustness', () => {
		it('should print help of a boot command without booting eagerly', async () => {
			const bootSpy = spyOn(Kernel.prototype, 'bootEager');

			class BootHelpCommand extends Command {
				public static readonly command = 'boot:help';
				public static readonly boot = true;
				public async run() {}
				public async help() {
					return 'boot help text';
				}
			}

			@Module.register({ commands: [BootHelpCommand] })
			class BootHelpModule extends Module {}

			@Application.register({ modules: [BootHelpModule] })
			class HelpApp extends Application {}

			await new HelpApp().run(['help', 'boot:help']);

			expect(bootSpy).not.toHaveBeenCalled();
			bootSpy.mockRestore();
		});

		it('should shut the kernel down before disabling the app context on stop', async () => {
			@Application.register({ server: { port: 0 } })
			class OrderApp extends Application {}

			const instance = new OrderApp();
			await serve(instance);
			const order: string[] = [];
			const storage = (instance as any)._appContextStorage;
			spyOn(storage, 'disable').mockImplementation(() => {
				order.push('disable');
			});
			const shutdown = instance.kernel.shutdown.bind(instance.kernel);
			spyOn(instance.kernel, 'shutdown').mockImplementation(async () => {
				order.push('shutdown');
				await shutdown();
			});

			await instance.elysia.stop();
			await nextTick();
			await nextTick();

			expect(order).toEqual(['shutdown', 'disable']);
		});

		it('should shut the kernel down and exit 1 on a signal when stop() rejects', async () => {
			@Application.register({ server: { port: 0 } })
			class StopApp extends Application {}

			const instance = new StopApp();
			await serve(instance);
			spyOn(instance.elysia, 'stop').mockRejectedValue(new Error('stop failed'));
			const shutdownSpy = spyOn(instance.kernel, 'shutdown');

			process.emit('SIGTERM');
			await nextTick();
			await nextTick();

			expect(shutdownSpy).toHaveBeenCalled();
			expect(process.exit).toHaveBeenCalledWith(1);
		});
	});

	describe('serve', () => {
		it('should handle the serve command', async () => {
			@Application.register({ server: { port: 0 }, modules: [], openapi: false })
			class TestApp extends Application {}

			Event.on('elysium:server:after-init', async (e) => {
				spyOn(e.source.elysia, 'listen');
			});

			const instance = new TestApp();
			await serve(instance);

			expect(instance.elysia.listen).toHaveBeenCalledWith(0);
		});

		it('should log incoming requests at debug level in debug mode', async () => {
			@Application.register({ debug: true, server: { port: 0 }, modules: [], openapi: false })
			class TestApp extends Application {}

			const instance = new TestApp();
			await serve(instance);

			const logger = new ConsoleLogger();
			const debugSpy = spyOn(logger, 'debug').mockImplementation(() => {});
			Service.instance(LOGGER_SERVICE, logger);
			try {
				await instance.elysia.handle(new Request('http://localhost/missing'));
				expect(debugSpy).toHaveBeenCalledWith('Incoming request', {
					method: 'GET',
					url: 'http://localhost/missing'
				});
			} finally {
				Service.remove(LOGGER_SERVICE);
			}
		});

		it('should serve a controller with its module private service, in the module context', async () => {
			@Service.register()
			class PrivateService {
				value = 'from-a';
			}

			let seen: string | undefined;

			@Http.controller({ path: '/a' })
			class AController {
				@Http.get({ path: '/x' })
				x() {
					seen = ModuleContext.current()?.id;
					return { value: Service.make(PrivateService).value };
				}
			}

			@Middleware.register(AfterResponseProbe)
			@Module.register({ services: [PrivateService], controllers: [AController] })
			class A extends Module {}

			@Application.register({ server: { port: 0 }, modules: [A], openapi: false })
			class TestApp extends Application {}

			const instance = new TestApp();
			await serve(instance);

			const response = await request(instance, 'http://localhost/a/x');
			expect(response.status).toBe(200);
			expect(await response.json()).toEqual({ value: 'from-a' });
			expect(seen).toBe('A');
		});

		it('should inject module services in route parameters and keep the context in generators', async () => {
			@Service.register()
			class Greeter {
				hello = 'hi';
			}

			const seen: (string | undefined)[] = [];

			@Http.controller({ path: '/p' })
			class PController {
				@Http.get({ path: '/inject' })
				inject(@Service.inject(Greeter) greeter: Greeter) {
					return greeter.hello;
				}

				@Http.get({ path: '/stream' })
				async *stream() {
					seen.push(ModuleContext.current()?.id);
					await Promise.resolve();
					seen.push(ModuleContext.current()?.id);
					yield 'a';
				}
			}

			@Middleware.register(AfterResponseProbe)
			@Module.register({ services: [Greeter], controllers: [PController] })
			class A extends Module {}

			@Application.register({ server: { port: 0 }, modules: [A], openapi: false })
			class TestApp extends Application {}

			const instance = new TestApp();
			await serve(instance);

			const injected = await request(instance, 'http://localhost/p/inject');
			expect(await injected.text()).toBe('hi');

			const streamed = await request(instance, 'http://localhost/p/stream');
			await streamed.text();
			expect(seen).toEqual(['A', 'A']);
		});

		it('should prefix the controllers of a module with its prefix', async () => {
			@Http.controller({ path: '/x' })
			class XController {
				@Http.get({ path: '/' })
				x() {
					return 'ok';
				}
			}

			@Middleware.register(AfterResponseProbe)
			@Module.register({ controllers: [XController], prefix: '/api' })
			class A extends Module {}

			@Application.register({ server: { port: 0 }, modules: [A], openapi: false })
			class TestApp extends Application {}

			const instance = new TestApp();
			await serve(instance);

			const response = await request(instance, 'http://localhost/api/x');
			expect(response.status).toBe(200);
			expect(await response.text()).toBe('ok');
		});

		it('should build module middlewares with access to the module services', async () => {
			@Service.register()
			class Secret {
				value = 'secret';
			}

			let built: string | undefined;

			class GuardMiddleware extends Middleware {
				constructor() {
					super();
					built = Service.make(Secret).value;
				}

				public onBeforeHandle(ctx: any) {
					ctx.set.headers['x-guard'] = ModuleContext.current()?.id;
				}
			}

			@Http.controller({ path: '/g' })
			class GController {
				@Http.get({ path: '/' })
				get() {
					return 'ok';
				}
			}

			@Middleware.register(GuardMiddleware, AfterResponseProbe)
			@Module.register({ services: [Secret], controllers: [GController] })
			class A extends Module {}

			@Application.register({ server: { port: 0 }, modules: [A], openapi: false })
			class TestApp extends Application {}

			const instance = new TestApp();
			await serve(instance);

			const response = await request(instance, 'http://localhost/g');
			expect(built).toBe('secret');
			expect(response.headers.get('x-guard')).toBe('A');
		});

		it('should call onServe with the root app, imports first, before controllers mount', async () => {
			const order: string[] = [];
			const apps: unknown[] = [];

			@Http.controller({ path: '/c' })
			class CController {
				@Http.get({ path: '/' })
				get() {
					return 'ok';
				}
			}

			@Module.register()
			class Base extends Module {
				onServe(app: any) {
					order.push(`Base:${ModuleContext.current()?.id}`);
					apps.push(app);
				}
			}

			@Module.register({ imports: [Base], controllers: [CController] })
			class Feature extends Module {
				onServe(app: any) {
					order.push(`Feature:${ModuleContext.current()?.id}`);
					apps.push(app);
					order.push(`routes:${app.routes.length}`);
				}
			}

			@Application.register({ server: { port: 0 }, modules: [Feature], openapi: false })
			class TestApp extends Application {}

			const instance = new TestApp();
			await serve(instance);

			expect(order).toEqual(['Base:Base', 'Feature:Feature', 'routes:0']);
			expect(apps[0]).toBe(instance.elysia);
			expect(apps[1]).toBe(instance.elysia);
			expect(instance.elysia.routes.length).toBeGreaterThan(0);
		});

		it('should not listen and should exit 1 when the eager boot fails', async () => {
			@Service.register()
			class Broken {
				onInit() {
					throw new Error('boot failed');
				}
			}

			@Module.register({ services: [Broken] })
			class A extends Module {}

			@Application.register({ server: { port: 0 }, modules: [A], openapi: false })
			class TestApp extends Application {}

			let listenSpy: Mock<(...args: any[]) => any> | undefined;
			Event.on('elysium:server:before-init', (e) => {
				listenSpy = spyOn(e.source.elysia, 'listen');
			});

			const instance = new TestApp();
			await instance.run(['serve']);

			// The boot fails before the server is built, so there is nothing that could listen.
			expect(listenSpy).toBeUndefined();
			expect(process.exit).toHaveBeenCalledWith(1);
			expect(errors).toContain('boot failed');
		});

		it('should exit 1 without listening when onServe throws', async () => {
			@Module.register()
			class A extends Module {
				onServe() {
					throw new Error('serve hook failed');
				}
			}

			@Application.register({ server: { port: 0 }, modules: [A], openapi: false })
			class TestApp extends Application {}

			let listenSpy: Mock<(...args: any[]) => any> | undefined;
			Event.on('elysium:server:before-init', (e) => {
				listenSpy = spyOn(e.source.elysia, 'listen');
			});

			await new TestApp().run(['serve']);

			expect(listenSpy).toBeDefined();
			expect(listenSpy).not.toHaveBeenCalled();
			expect(process.exit).toHaveBeenCalledWith(1);
			expect(errors).toContain('serve hook failed');
		});

		it('should reject a listed controller that is not decorated', async () => {
			class NotAController {}

			@Module.register({ controllers: [NotAController] })
			class A extends Module {}

			@Application.register({ server: { port: 0 }, modules: [A], openapi: false })
			class TestApp extends Application {}

			await new TestApp().run(['serve']);

			expect(process.exit).toHaveBeenCalledWith(1);
			expect(errors).toContain('NotAController');
		});

		it('should shut the kernel down when the server stops', async () => {
			const destroyed: string[] = [];

			@Service.register()
			class Tracked {
				onDestroy() {
					destroyed.push('Tracked');
				}
			}

			@Module.register({ services: [Tracked] })
			class A extends Module {}

			@Application.register({ server: { port: 0 }, modules: [A], openapi: false })
			class TestApp extends Application {}

			const instance = new TestApp();
			await serve(instance);
			await instance.elysia.stop();

			expect(destroyed).toEqual(['Tracked']);
		});
	});

	describe('lifecycle hooks', () => {
		it('should call onStart when the server starts', async () => {
			@Application.register({ server: { port: 0 } })
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
			@Application.register({ server: { port: 0 } })
			class TestApp extends Application {
				protected async onStop(): Promise<void> {}
			}

			// @ts-expect-error The onStop method is protected
			const onStopSpy = spyOn(TestApp.prototype, 'onStop');
			const emitSpy = spyOn(Event, 'emit');

			const instance = new TestApp();
			await serve(instance);

			await instance.elysia.stop();

			expect(onStopSpy).toHaveBeenCalledWith(instance.elysia);
			expect(emitSpy).toHaveBeenCalledWith('elysium:server:stop', instance.elysia, instance);
		});

		it('should call onError when an error occurs', async () => {
			@Http.controller({ path: '/' })
			class FailingController {
				@Http.get({ path: '/' })
				fail() {
					throw new Error('Test error');
				}
			}

			@Middleware.register(AfterResponseProbe)
			@Module.register({ controllers: [FailingController] })
			class A extends Module {}

			@Application.register({ server: { port: 0 }, modules: [A], openapi: false })
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

			const response = await request(instance, 'http://localhost/');

			expect(response.status).toBe(500);
			expect(await response.json()).toMatchObject({ type: 'UNKNOWN' });

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

			@Application.register({ server: { port: 0 } })
			class TestApp extends Application {}

			Metadata.define(Symbols.middlewares, mockMiddlewares, TestApp);

			const instance = new TestApp();
			await serve(instance);

			expect(applyMiddlewaresSpy).toHaveBeenCalledWith(mockMiddlewares, instance.elysia, null);
		});
	});
});
