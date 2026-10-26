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

import { Service } from '@elysiumjs/core';
import { beforeEach, describe, expect, it, spyOn } from 'bun:test';

import { HermesLogger } from '../src/services/logger.service';

describe('HermesLogger', () => {
	beforeEach(() => {
		Service.clear();
	});

	describe('constructor', () => {
		it('should create a logger with default config', () => {
			const logger = new HermesLogger();
			expect(logger).toBeDefined();
		});

		it('should create a logger with custom config', () => {
			const logger = new HermesLogger({ level: 'debug', name: 'test' });
			expect(logger).toBeDefined();
		});

		it('should create a logger with pretty format', () => {
			const logger = new HermesLogger({ level: 'info', format: 'pretty' });
			expect(logger).toBeDefined();
		});
	});

	describe('log methods', () => {
		let logger: HermesLogger;

		beforeEach(() => {
			logger = new HermesLogger({ level: 'trace' });
		});

		it('should call trace without error', () => {
			expect(() => logger.trace('trace message')).not.toThrow();
		});

		it('should call debug without error', () => {
			expect(() => logger.debug('debug message')).not.toThrow();
		});

		it('should call info without error', () => {
			expect(() => logger.info('info message')).not.toThrow();
		});

		it('should call warn without error', () => {
			expect(() => logger.warn('warn message')).not.toThrow();
		});

		it('should call error without error', () => {
			expect(() => logger.error('error message')).not.toThrow();
		});

		it('should call fatal without error', () => {
			expect(() => logger.fatal('fatal message')).not.toThrow();
		});

		it('should accept context objects', () => {
			expect(() => logger.info('with context', { userId: '123' })).not.toThrow();
		});

		it('should accept undefined context', () => {
			expect(() => logger.info('no context', undefined)).not.toThrow();
		});
	});

	describe('child()', () => {
		it('should create a child logger', () => {
			const logger = new HermesLogger({ level: 'info' });
			const child = logger.child({ service: 'test' });

			expect(child).toBeDefined();
			expect(child).toBeInstanceOf(HermesLogger);
		});

		it('should be able to log from child', () => {
			const logger = new HermesLogger({ level: 'info' });
			const child = logger.child({ service: 'test' });

			expect(() => child.info('child message')).not.toThrow();
		});
	});

	describe('static make()', () => {
		it('should create a logger when no Service instance exists', () => {
			const logger = HermesLogger.make('test-service');
			expect(logger).toBeDefined();
			expect(logger).toBeInstanceOf(HermesLogger);
		});

		it('should use Service instance when registered', () => {
			const baseLogger = new HermesLogger({ level: 'debug' });
			Service.instance(HermesLogger.name, baseLogger as any);

			try {
				const childSpy = spyOn(baseLogger, 'child');
				const logger = HermesLogger.make('from-service');

				expect(childSpy).toHaveBeenCalledWith({ name: 'from-service' });
				expect(logger).toBeInstanceOf(HermesLogger);
			} finally {
				// Global services outlive the test file; later files expect none.
				Service.remove(HermesLogger.name);
			}
		});
	});
});
