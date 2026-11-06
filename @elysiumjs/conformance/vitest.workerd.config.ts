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

import { cloudflareTest } from '@cloudflare/vitest-plugin';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// The workerd lane. The tests run inside workerd, in the Worker `wrangler.jsonc` describes, through
// the Workers Vitest integration. `@elysiumjs/core` and `@elysiumjs/runtime-workers` resolve to
// their built `dist` (their `module` field): run `bun run build` first. As in the Node lane, SWC
// compiles the legacy decorators and emits `design:paramtypes` for constructor injection.
// `tests/workerd/setup.ts` explains the two shims the lane needs.
//
// KNOWN GAP: the scenarios run Elysia's just-in-time compiled handlers (code generated from
// strings, through the integration's `unsafeEval`), not the ahead-of-time compiled handlers a
// deployed Worker runs. See the top of `tests/workerd/setup.ts`.
export default defineConfig({
	plugins: [
		swc.vite({
			jsc: {
				parser: { syntax: 'typescript', decorators: true },
				transform: { legacyDecorator: true, decoratorMetadata: true },
				target: 'es2022'
			}
		}),
		cloudflareTest({ wrangler: { configPath: './wrangler.jsonc' } })
	],
	test: {
		include: ['tests/workerd/**/*.test.ts'],
		setupFiles: ['tests/workerd/setup.ts']
	}
});
