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

import { Module } from '@elysiumjs/core';

import { argusPlugin } from './plugin';
import { ArgusSDK } from './sdk';

/**
 * Configurable module that starts the {@link ArgusSDK} on init, installs the request-span
 * plugin on the root app when serving, and shuts the SDK down on destroy.
 *
 * `serviceName` has no sensible default and is required.
 * @author Axel Nana <axel.nana@workbud.com>
 */
@Module.register({})
export class ArgusModule extends Module.configurable<TracingConfig>({
	defaults: { enabled: true, exporter: 'console' },
	required: ['serviceName']
}) {
	#started = false;

	public override onInit(): void {
		ArgusSDK.initialize(this.config);
		this.#started = true;
	}

	public override onServe(app: Parameters<Module['onServe']>[0]): void {
		app.use(argusPlugin());
	}

	public override async onDestroy(): Promise<void> {
		if (!this.#started) return;
		this.#started = false;
		await ArgusSDK.shutdown();
	}
}
