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

import type { LoggerInterface } from '../src/logger';

import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test';

import { Container } from '../src/container';
import { Kernel } from '../src/kernel';
import { ConsoleLogger, getLogger, LOGGER_SERVICE } from '../src/logger';
import { Module } from '../src/module';
import { ModuleContext } from '../src/module-context';
import { buildModuleGraph } from '../src/module-graph';
import { Service } from '../src/service';

const fakeLogger = (): LoggerInterface & { child: ReturnType<typeof mock> } => {
	const logger = {
		trace: mock(),
		debug: mock(),
		info: mock(),
		warn: mock(),
		error: mock(),
		fatal: mock(),
		child: mock((_ctx: Record<string, unknown>): LoggerInterface => logger)
	};
	return logger;
};

describe('getLogger', () => {
	afterEach(() => {
		if (Service.exists(LOGGER_SERVICE)) Service.remove(LOGGER_SERVICE);
	});

	it('resolves the global logger service, not one a module declares', async () => {
		const moduleLogger = fakeLogger();
		@Module.register({ services: [{ name: LOGGER_SERVICE, factory: () => moduleLogger }] })
		class WithOwnLogger extends Module {}

		const graph = buildModuleGraph([WithOwnLogger], 'test');
		const kernel = new Kernel(graph);
		try {
			await kernel.register();
			await kernel.initModule(graph.node(WithOwnLogger)!);
			const globalLogger = fakeLogger();
			Service.instance(LOGGER_SERVICE, globalLogger);

			ModuleContext.run(graph.node(WithOwnLogger)!, () => {
				expect(Service.get(LOGGER_SERVICE)).toBe(moduleLogger);
				expect(getLogger()).toBe(globalLogger);
			});
		} finally {
			Container.reset();
			Container.setVisibility(null);
			Container.setModuleInitHook(null);
			Container.setSkippedLookup(null);
		}
	});

	it('uses the logger service name', () => {
		expect(LOGGER_SERVICE).toBe('logger');
	});

	it('falls back to a ConsoleLogger without a logger service', () => {
		expect(getLogger()).toBeInstanceOf(ConsoleLogger);
	});

	it('returns the registered logger service', () => {
		const logger = fakeLogger();
		Service.instance(LOGGER_SERVICE, logger);

		expect(getLogger()).toBe(logger);
		expect(logger.child).not.toHaveBeenCalled();
	});

	it('resolves the logger service at call time', () => {
		expect(getLogger()).toBeInstanceOf(ConsoleLogger);

		const logger = fakeLogger();
		Service.instance(LOGGER_SERVICE, logger);

		expect(getLogger()).toBe(logger);
	});

	it('falls back to a ConsoleLogger when the logger service cannot be built', () => {
		Service.registerLazy(LOGGER_SERVICE, () => {
			throw new Error('broken logger');
		});

		expect(getLogger()).toBeInstanceOf(ConsoleLogger);
	});

	it('returns a child logger with the given context', () => {
		const logger = fakeLogger();
		Service.instance(LOGGER_SERVICE, logger);

		getLogger({ component: 'test' });

		expect(logger.child).toHaveBeenCalledWith({ component: 'test' });
	});

	it('carries the context on the ConsoleLogger fallback', () => {
		const consoleInfo = spyOn(console, 'info').mockImplementation(() => {});
		try {
			getLogger({ component: 'test' }).info('hello', { extra: 1 });
			expect(consoleInfo).toHaveBeenCalledWith('[INFO] hello', { component: 'test', extra: 1 });
		} finally {
			consoleInfo.mockRestore();
		}
	});
});

describe('ConsoleLogger', () => {
	it('passes an error in ctx through intact, keeping its stack', () => {
		const consoleError = spyOn(console, 'error').mockImplementation(() => {});
		try {
			const error = new Error('boom');
			new ConsoleLogger().error('failed', { error });

			const [, ctx] = consoleError.mock.calls[0] as [string, { error: Error }];
			expect(ctx.error).toBe(error);
			expect(ctx.error.stack).toContain('boom');
		} finally {
			consoleError.mockRestore();
		}
	});
});
