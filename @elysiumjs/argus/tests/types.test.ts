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

import { describe, expect, it } from 'bun:test';

import type { TracingConfig } from '../src/types';

describe('TracingConfig type', () => {
	it('should accept a minimal config', () => {
		const config: TracingConfig = {
			enabled: true,
			serviceName: 'my-service',
			exporter: 'console'
		};

		expect(config.enabled).toBe(true);
		expect(config.serviceName).toBe('my-service');
		expect(config.exporter).toBe('console');
	});

	it('should accept otlp-http exporter with endpoint', () => {
		const config: TracingConfig = {
			enabled: true,
			serviceName: 'my-service',
			exporter: 'otlp-http',
			endpoint: 'http://localhost:4318/v1/traces'
		};

		expect(config.exporter).toBe('otlp-http');
		expect(config.endpoint).toBe('http://localhost:4318/v1/traces');
	});

	it('should accept samplingRate', () => {
		const config: TracingConfig = {
			enabled: true,
			serviceName: 'my-service',
			exporter: 'console',
			samplingRate: 0.5
		};

		expect(config.samplingRate).toBe(0.5);
	});

	it('should allow optional fields to be undefined', () => {
		const config: TracingConfig = {
			enabled: false,
			serviceName: 'test',
			exporter: 'console'
		};

		expect(config.endpoint).toBeUndefined();
		expect(config.samplingRate).toBeUndefined();
	});
});
