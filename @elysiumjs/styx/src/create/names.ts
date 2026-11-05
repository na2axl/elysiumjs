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

import { relative, resolve, sep } from 'node:path';

/** An npm package name, optionally scoped. Dot-only segments are refused separately. */
const PACKAGE_NAME = /^(?:@([a-z0-9-~][a-z0-9-._~]*)\/)?([a-z0-9-~][a-z0-9-._~]*)$/;

/** A module name: it becomes a folder, a file and a class name. */
const MODULE_NAME = /^[a-z][a-z0-9-]*$/;

/**
 * Thrown when a project or module name given to `styx create` is not usable.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class InvalidNameError extends Error {
	/**
	 * @param kind What the name is for, such as `project` or `module`.
	 * @param value The refused name.
	 * @param reason Why it is refused.
	 */
	constructor(
		public readonly kind: string,
		public readonly value: string,
		public readonly reason: string
	) {
		super(`Invalid ${kind} name "${value}": ${reason}`);
	}
}

/**
 * Checks a project name, which must be a lower-case npm package name, optionally scoped.
 * @author Axel Nana <axel.nana@workbud.com>
 * @param name The project name.
 * @returns The name of the project directory: the name without its scope.
 * @throws {InvalidNameError} When the name is not a valid package name.
 */
export const validateProjectName = (name: string): string => {
	const match = PACKAGE_NAME.exec(name);
	if (!match) {
		throw new InvalidNameError(
			'project',
			name,
			'use lower-case letters, digits, "-", "_", "." or "~", optionally under an @scope/'
		);
	}
	const [, scope, directory] = match;
	if ([scope, directory].some((part) => part !== undefined && /^\.+$/.test(part))) {
		throw new InvalidNameError('project', name, 'a name cannot be "." or ".."');
	}
	return directory!;
};

/**
 * Checks a module name.
 * @author Axel Nana <axel.nana@workbud.com>
 * @param name The module name.
 * @returns The name, unchanged.
 * @throws {InvalidNameError} When the name does not start with a lower-case letter followed by
 * lower-case letters, digits or "-".
 */
export const validateModuleName = (name: string): string => {
	if (!MODULE_NAME.test(name)) {
		throw new InvalidNameError(
			'module',
			name,
			'start with a lower-case letter, then use lower-case letters, digits or "-"'
		);
	}
	return name;
};

/**
 * Resolves the directory of a new project, which must lie strictly inside `base`.
 * @author Axel Nana <axel.nana@workbud.com>
 * @param base The folder the project is created in.
 * @param directory The project directory, from {@link validateProjectName}.
 * @returns The absolute project path.
 * @throws {InvalidNameError} When the path would leave `base` or be `base` itself.
 */
export const resolveProjectPath = (base: string, directory: string): string => {
	const path = resolve(base, directory);
	const inside = relative(resolve(base), path);
	if (
		inside === '' ||
		inside === '..' ||
		inside.startsWith(`..${sep}`) ||
		resolve(inside) === inside
	) {
		throw new InvalidNameError('project', directory, `it must be a folder inside ${resolve(base)}`);
	}
	return path;
};
