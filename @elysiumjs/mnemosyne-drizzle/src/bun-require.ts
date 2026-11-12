// Copyright (c) 2025-present Workbud Technologies Inc. All rights reserved.
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
 * The `require` of the module on Bun (`import.meta.require`), or `undefined` elsewhere. It is read
 * by key: a bundler turns `import.meta.require` into `createRequire(import.meta.url)` at the top of
 * the module, which throws on Workers, where `import.meta.url` is undefined.
 * @internal
 */
export const bunRequire = (): NodeJS.Require | undefined =>
	(import.meta as unknown as Record<string, NodeJS.Require | undefined>)['require'];
