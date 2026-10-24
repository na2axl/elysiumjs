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

import type { TracingConfig } from './types';

import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { ConsoleSpanExporter, TraceIdRatioBasedSampler } from '@opentelemetry/sdk-trace-base';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

/**
 * ArgusSDK initializes OpenTelemetry for the Elysium framework.
 *
 * CRITICAL: For full auto-instrumentation this MUST be called before any
 * application code runs (e.g. from a `--preload` file). Auto-instrumentation
 * patches modules at import time; modules imported before OTel is initialized
 * won't be instrumented. `ArgusModule` initialises the SDK in `onInit`, which
 * only covers modules loaded afterwards; when the SDK was already initialised
 * (e.g. by a preload), the module detects it with {@link ArgusSDK.isInitialized}
 * and leaves it alone.
 *
 * @example
 * ```typescript
 * // src/instrument.ts (loaded FIRST via --preload or entrypoint)
 * import { ArgusSDK } from '@elysiumjs/argus';
 *
 * ArgusSDK.initialize({
 *   enabled: true,
 *   serviceName: 'my-api',
 *   exporter: 'otlp-http',
 *   endpoint: 'http://localhost:4318/v1/traces'
 * });
 * ```
 *
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class ArgusSDK {
	private static instance: ArgusSDK | undefined;
	private sdk: NodeSDK | null = null;

	private constructor() {}

	/**
	 * Whether {@link ArgusSDK.initialize} has already been called.
	 * @author Axel Nana <axel.nana@workbud.com>
	 */
	public static isInitialized(): boolean {
		return ArgusSDK.instance !== undefined;
	}

	/**
	 * Initializes the OpenTelemetry SDK.
	 * Can only be called once — subsequent calls are ignored with a warning.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param config The tracing configuration.
	 */
	public static initialize(config: TracingConfig): void {
		if (ArgusSDK.instance) {
			console.error('[Argus] SDK already initialized. Ignoring duplicate call.');
			return;
		}

		ArgusSDK.instance = new ArgusSDK();

		if (!config.enabled) return;

		const exporter = ArgusSDK.createExporter(config);

		ArgusSDK.instance.sdk = new NodeSDK({
			resource: resourceFromAttributes({
				[ATTR_SERVICE_NAME]: config.serviceName
			}),
			traceExporter: exporter,
			...(config.samplingRate !== undefined && {
				sampler: new TraceIdRatioBasedSampler(config.samplingRate)
			})
		});

		ArgusSDK.instance.sdk.start();
	}

	/**
	 * Creates the appropriate trace exporter based on the config.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param config The tracing configuration.
	 * @returns A span exporter instance.
	 */
	private static createExporter(config: TracingConfig) {
		switch (config.exporter) {
			case 'otlp-http':
				return new OTLPTraceExporter({
					url: config.endpoint ?? 'http://localhost:4318/v1/traces'
				});
			case 'console':
			default:
				return new ConsoleSpanExporter();
		}
	}

	/**
	 * Shuts down the OpenTelemetry SDK gracefully.
	 * @author Axel Nana <axel.nana@workbud.com>
	 */
	public static async shutdown(): Promise<void> {
		if (ArgusSDK.instance?.sdk) {
			await ArgusSDK.instance.sdk.shutdown();
		}
		ArgusSDK.instance = undefined;
	}
}
