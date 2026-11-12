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

/**
 * Configuration for the Argus telemetry SDK.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export interface TracingConfig {
	/**
	 * Whether tracing is enabled.
	 */
	enabled: boolean;

	/**
	 * The service name reported in spans.
	 */
	serviceName: string;

	/**
	 * The exporter to use. Only `otlp-http` and `console` are supported.
	 * gRPC is not supported on Bun.
	 */
	exporter: 'otlp-http' | 'console';

	/**
	 * The OTLP endpoint URL.
	 * @default 'http://localhost:4318/v1/traces'
	 */
	endpoint?: string;

	/**
	 * Sampling rate between 0.0 and 1.0.
	 * @default 1.0
	 */
	samplingRate?: number;
}
