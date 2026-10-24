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

export { HephaestusModule } from './hephaestus.module';
export type { HephaestusConfig, PlatformTarget } from './types';
export { HephaestusConfigSchema, PlatformTargetSchema } from './types';

export type { BuildResult } from './builder';
export { BinaryBuilder } from './builder';

export type { AssetManifest } from './assets';
export { AssetEmbedder } from './assets';

export { DockerGenerator } from './commands/docker.generator';
export { loadConfig } from './config';
export { bunTarget, detectCurrentPlatform, getOutputName } from './platform';
