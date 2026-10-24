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

import { pascal } from 'radash';

import { getProjectPath } from './utils';

/**
 * Describes the Elysium project's configuration.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export interface ProjectConfig {
	/**
	 * The name of the Elysium project.
	 */
	projectName: string;

	/**
	 * Whether the Elysium project is a mono module.
	 */
	mono: boolean;

	/**
	 * A map of module names to their paths.
	 *
	 * Only used if the Elysium project is not a mono module.
	 */
	modules?: Record<string, string>;
}

/**
 * Parses the Elysium project's configuration file.
 * @author Axel Nana <axel.nana@workbud.com>
 * @throws If the Elysium config file is not found.
 * @returns The Elysium project's configuration.
 */
export const parseProjectConfig = async (): Promise<ProjectConfig> => {
	const file = Bun.file(join(getProjectPath(), '.elysiumrc'));
	if (!file.exists()) {
		throw new Error('Elysium config file not found.');
	}

	return file.json();
};

/**
 * Writes the Elysium project's configuration file.
 * @author Axel Nana <axel.nana@workbud.com>
 * @param config The Elysium project's configuration.
 */
export const writeProjectConfig = async (config: ProjectConfig) => {
	const file = Bun.file(join(getProjectPath(), '.elysiumrc'));
	await file.write(JSON.stringify(config, null, 2));
};

/**
 * Checks if the Elysium project is a mono-module project.
 * @author Axel Nana <axel.nana@workbud.com>
 * @returns Whether the Elysium project is a mono module.
 */
export const isMonoModule = async () => {
	const config = await parseProjectConfig();
	return config.mono;
};

/**
 * Gets the path of a module.
 * @author Axel Nana <axel.nana@workbud.com>
 * @param moduleName The name of the module.
 * @returns The path of the module.
 */
export const getModulePath = async (moduleName: string) => {
	const config = await parseProjectConfig();
	if (config.mono) {
		return './src';
	}

	return config.modules![moduleName];
};

/**
 * Builds the hint telling the user which module list a generated class must be added to.
 * @author Axel Nana <axel.nana@workbud.com>
 * @param list The module list to add the class to.
 * @param className The generated class name.
 * @param moduleName The module the class was generated in, if any.
 * @returns The hint to print.
 */
export const addToModuleHint = async (
	list: 'commands' | 'jobs' | 'services' | 'controllers',
	className: string,
	moduleName?: string
) => {
	const name = moduleName ?? 'main';
	const path = await getModulePath(name);
	return `Add ${className} to the ${list} list of ${pascal(name)}Module in ${path}/${name}.module.ts.`;
};

/**
 * Checks if a module exists.
 * @author Axel Nana <axel.nana@workbud.com>
 * @param moduleName The name of the module.
 * @returns Whether the module exists.
 */
export const moduleExists = async (moduleName: string) => {
	const path = await getModulePath(moduleName);
	return Bun.file(path).exists();
};
