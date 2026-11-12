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

import { join } from 'node:path';

import { describe, expect, it } from 'bun:test';

describe('bundle', () => {
	it('evaluates without import.meta.url, as on Workers', async () => {
		const result = await Bun.build({
			entrypoints: [join(import.meta.dir, '../src/index.ts')],
			target: 'node',
			packages: 'external'
		});
		expect(result.success).toBe(true);
		const code = await result.outputs[0]!.text();

		// For `import.meta.require` or `require`, the bundler defines `__require` with
		// `createRequire(import.meta.url)` at the top of the module, which throws on Workers.
		expect(code).not.toContain('__require');
	});
});
