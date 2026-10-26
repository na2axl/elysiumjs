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

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Gets the root path of the Elysium.js project: the closest parent holding an `.elysiumrc`, or
 * the current directory when there is none.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export const getProjectPath = (): string => {
	const startPath = process.cwd();
	let dir = startPath;

	while (true) {
		if (existsSync(join(dir, '.elysiumrc'))) return dir;

		const parentDir = dirname(dir);
		if (dir === parentDir) break;

		dir = parentDir;
	}

	return startPath;
};

/**
 * Gets the directory holding the migrations of the Elysium.js project.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export const getMigrationsPath = (): string => join(getProjectPath(), 'src/database/migrations');
