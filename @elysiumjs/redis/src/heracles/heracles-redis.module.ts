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

import { Module } from '@elysiumjs/olympus';

import { HeraclesCleanCommand } from './commands/clean.command';
import { HeraclesWorkCommand } from './commands/work.command';

/**
 * Provides the Heracles commands that run on Redis: `heracles:work` runs a worker that consumes
 * the queues of `RedisTransport`, and `heracles:clean` removes the finished jobs of their streams.
 * Import it next to `HeraclesModule` and `RedisModule`.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @example
 * ```ts
 * @Application.register({
 * 	modules: [
 * 		RedisModule.with({ connections: { default: { url: 'redis://localhost:6379' } } }),
 * 		HeraclesModule.with({ queues: { default: { transport: RedisTransport } } }),
 * 		HeraclesRedisModule
 * 	]
 * })
 * class App extends Application {}
 * ```
 */
@Module.register({ commands: [HeraclesCleanCommand, HeraclesWorkCommand] })
export class HeraclesRedisModule extends Module {}
