// Copyright (c) 2025-present Axel Nana <ax.lnana@outlook.com>. All rights reserved.
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

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The versions of the `@elysiumjs/*` packages of the workspace Styx is built in, by name. Import
 * it as a macro (`with { type: 'macro' }`): the map is read when Styx is bundled, so the published
 * CLI writes the versions it was released with.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export const elysiumVersions = (): Record<string, string> => {
	const packages = join(import.meta.dir, '..', '..', '..');
	const versions: Record<string, string> = {};
	for (const dir of readdirSync(packages)) {
		try {
			const pkg = JSON.parse(readFileSync(join(packages, dir, 'package.json'), 'utf8'));
			if (pkg.name?.startsWith('@elysiumjs/') && !pkg.private) versions[pkg.name] = pkg.version;
		} catch {
			// Not a package.
		}
	}
	return versions;
};
