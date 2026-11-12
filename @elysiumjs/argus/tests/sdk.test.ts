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

import { afterAll, beforeEach, describe, expect, it, spyOn } from 'bun:test';

import { ArgusSDK } from '../src/sdk';

describe('ArgusSDK', () => {
	beforeEach(async () => {
		// Shut down any existing SDK before resetting
		await ArgusSDK.shutdown();
		(ArgusSDK as any).instance = undefined;
	});

	afterAll(async () => {
		await ArgusSDK.shutdown();
		(ArgusSDK as any).instance = undefined;
	});

	describe('initialize', () => {
		it('should create an instance when enabled is false', () => {
			ArgusSDK.initialize({
				enabled: false,
				serviceName: 'test-service',
				exporter: 'console'
			});

			// Should not throw, instance is created but SDK not started
			expect((ArgusSDK as any).instance).toBeDefined();
		});

		it('should log error on duplicate initialization', () => {
			const errorSpy = spyOn(console, 'error').mockImplementation(() => {});

			ArgusSDK.initialize({
				enabled: false,
				serviceName: 'test-1',
				exporter: 'console'
			});

			ArgusSDK.initialize({
				enabled: false,
				serviceName: 'test-2',
				exporter: 'console'
			});

			expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('already initialized'));

			errorSpy.mockRestore();
		});

		it('should initialize with console exporter', () => {
			ArgusSDK.initialize({
				enabled: true,
				serviceName: 'test-service',
				exporter: 'console'
			});

			expect((ArgusSDK as any).instance).toBeDefined();
			expect((ArgusSDK as any).instance.sdk).toBeDefined();
		});

		it('should initialize with otlp-http exporter', () => {
			ArgusSDK.initialize({
				enabled: true,
				serviceName: 'test-service',
				exporter: 'otlp-http',
				endpoint: 'http://localhost:4318/v1/traces'
			});

			expect((ArgusSDK as any).instance).toBeDefined();
			expect((ArgusSDK as any).instance.sdk).toBeDefined();
		});

		it('should accept samplingRate option', () => {
			ArgusSDK.initialize({
				enabled: true,
				serviceName: 'test-service',
				exporter: 'console',
				samplingRate: 0.5
			});

			expect((ArgusSDK as any).instance.sdk).toBeDefined();
		});
	});

	describe('shutdown', () => {
		it('should not throw when not initialized', async () => {
			await expect(ArgusSDK.shutdown()).resolves.toBeUndefined();
		});

		it('should not throw when initialized but disabled', async () => {
			ArgusSDK.initialize({
				enabled: false,
				serviceName: 'test-service',
				exporter: 'console'
			});

			await expect(ArgusSDK.shutdown()).resolves.toBeUndefined();
		});

		it('should shut down the SDK when initialized', async () => {
			ArgusSDK.initialize({
				enabled: true,
				serviceName: 'test-service',
				exporter: 'console'
			});

			const sdk = (ArgusSDK as any).instance.sdk;
			const shutdownSpy = spyOn(sdk, 'shutdown').mockResolvedValue(undefined);

			await ArgusSDK.shutdown();
			expect(shutdownSpy).toHaveBeenCalled();

			shutdownSpy.mockRestore();
		});
	});
});
