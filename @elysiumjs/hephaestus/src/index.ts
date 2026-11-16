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

export { HephaestusModule } from './hephaestus.module.js';
export type { HephaestusConfig, PlatformTarget } from './types.js';
export { HephaestusConfigSchema, PlatformTargetSchema } from './types.js';

export type { BuildResult, WorkersBuildOptions, WorkersBuildResult } from './builder/index.js';
export { BinaryBuilder, NodeBuilder, WorkersBuilder } from './builder/index.js';

export type { AssetManifest } from './assets/index.js';
export { AssetEmbedder } from './assets/index.js';

export { DockerGenerator } from './commands/docker.generator.js';
export { loadConfig } from './config/index.js';
export { bunTarget, detectCurrentPlatform, getOutputName } from './platform/index.js';
