// Copyright (c) 2025-present Axel Nana <ax.lnana@outlook.com>. All rights reserved.
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

import { beforeEach, describe, expect, it } from 'bun:test';

import { Env, initEnv } from '../src/env';

describe('Env namespace', () => {
	beforeEach(() => {
		Env.clear();
	});

	it('should initialize environment variables correctly with valid inputs', () => {
		// Arrange
		const vars = {
			NODE_ENV: 'test',
			PORT: 3000,
			DEBUG: true
		};

		// Act
		initEnv(vars);

		// Assert
		expect(Env.get('NODE_ENV')).toBe('test');
		expect(Env.get('PORT')).toBe(3000);
		expect(Env.get('DEBUG')).toBe(true);
		expect(Env.exists('NODE_ENV')).toBe(true);
		expect(Env.exists('PORT')).toBe(true);
		expect(Env.exists('DEBUG')).toBe(true);
		expect(Env.exists('UNKNOWN')).toBe(false);
	});

	it('should handle empty object when initializing environment variables', () => {
		// Arrange
		const emptyVars = {};

		// Act
		initEnv(emptyVars);

		// Assert
		expect(Env.exists('NODE_ENV')).toBe(false);
		expect(Env.exists('PORT')).toBe(false);
		expect(() => Env.get('NODE_ENV')).not.toThrow();
		expect(Env.get('NODE_ENV')).toBeUndefined();
	});

	it('should correctly get a string environment variable', () => {
		// Arrange
		const vars = {
			APP_NAME: 'elysium'
		};

		// Act
		initEnv(vars);

		// Assert
		expect(Env.get('APP_NAME')).toBe('elysium');
		expect(typeof Env.get('APP_NAME')).toBe('string');
	});

	it('should correctly get a numeric environment variable', () => {
		// Arrange
		const vars = {
			PORT: 8080
		};

		// Act
		initEnv(vars);

		// Assert
		expect(Env.get('PORT')).toBe(8080);
		expect(typeof Env.get('PORT')).toBe('number');
	});

	it('should correctly get a boolean environment variable', () => {
		// Arrange
		const vars = {
			DEBUG: true,
			FEATURE_FLAG: false
		};

		// Act
		initEnv(vars);

		// Assert
		expect(Env.get('DEBUG')).toBe(true);
		expect(Env.get('FEATURE_FLAG')).toBe(false);
		expect(typeof Env.get('DEBUG')).toBe('boolean');
		expect(typeof Env.get('FEATURE_FLAG')).toBe('boolean');
	});

	it('should overwrite existing environment variables when initializing with the same key', () => {
		// Arrange
		const initialVars = {
			APP_ENV: 'development',
			PORT: 3000,
			DEBUG: true
		};

		const updatedVars = {
			APP_ENV: 'production',
			PORT: 8080
		};

		// Act
		initEnv(initialVars);
		const beforeOverwrite = {
			appEnv: Env.get('APP_ENV'),
			port: Env.get('PORT'),
			debug: Env.get('DEBUG')
		};

		initEnv(updatedVars);

		// Assert
		expect(beforeOverwrite.appEnv).toBe('development');
		expect(beforeOverwrite.port).toBe(3000);
		expect(beforeOverwrite.debug).toBe(true);

		expect(Env.get('APP_ENV')).toBe('production');
		expect(Env.get('PORT')).toBe(8080);
		expect(Env.get('DEBUG')).toBe(true); // Not overwritten, should remain the same
		expect(Env.exists('APP_ENV')).toBe(true);
		expect(Env.exists('PORT')).toBe(true);
		expect(Env.exists('DEBUG')).toBe(true);
	});

	it('should clear all environment variables when clear() is called', () => {
		// Arrange
		const vars = {
			NODE_ENV: 'development',
			PORT: 8080,
			DEBUG: true
		};

		initEnv(vars);

		// Verify variables are set before clearing
		expect(Env.exists('NODE_ENV')).toBe(true);
		expect(Env.exists('PORT')).toBe(true);
		expect(Env.exists('DEBUG')).toBe(true);

		// Act
		Env.clear();

		// Assert
		expect(Env.exists('NODE_ENV')).toBe(false);
		expect(Env.exists('PORT')).toBe(false);
		expect(Env.exists('DEBUG')).toBe(false);
		expect(Env.get('NODE_ENV')).toBeUndefined();
		expect(Env.get('PORT')).toBeUndefined();
		expect(Env.get('DEBUG')).toBeUndefined();
	});
});
