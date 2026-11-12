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

import type { FlowOptions } from './engine';

import { Module } from '../index';

import { ARIADNE_OPTIONS } from './engine';
import { FlowRouteTypes } from './route-types';

/**
 * Configures where flows live. The flows themselves are `@Flow.controller()` classes, listed in
 * the `controllers` of a module like any controller. In development, it also registers
 * {@link FlowRouteTypes}, which types the flow routes for `styx routes:generate`.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @example
 * ```ts
 * @Module.register({ controllers: [SignUpFlow] })
 * class AuthModule extends Module {}
 *
 * @Application.register({
 * 	modules: [AriadneModule.with({ store: new MemoryFlowStore() }), AuthModule]
 * })
 * class App extends Application {}
 * ```
 */
@Module.register<FlowOptions>({
	services: (config) => [
		{ name: ARIADNE_OPTIONS, global: true, factory: () => config },
		FlowRouteTypes
	]
})
export class AriadneModule extends Module.configurable<FlowOptions>({ required: ['store'] }) {}
