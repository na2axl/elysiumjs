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

import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// The Node lane. `@elysiumjs/core` and `@elysiumjs/runtime-node` resolve to their built
// `dist` (their `module` field, see `resolve.mainFields`): run `bun run build` first. The scenarios are TypeScript with
// legacy decorators, and Vitest's default transform does not emit `design:paramtypes`, which
// the container reads for constructor injection: SWC compiles them instead.
export default defineConfig({
	plugins: [
		swc.vite({
			jsc: {
				parser: { syntax: 'typescript', decorators: true },
				transform: { legacyDecorator: true, decoratorMetadata: true },
				target: 'es2022'
			}
		})
	],
	// The workspace packages declare only `module` (no `main` or `exports`), and Vitest clears
	// the main fields of the server environment Node tests run in.
	environments: { ssr: { resolve: { mainFields: ['module'] } } },
	test: {
		include: ['tests/node/**/*.test.ts'],
		environment: 'node',
		pool: 'forks'
	}
});
