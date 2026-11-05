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

import { pascal } from 'radash';

import { version } from '../../package.json';

/** The ranges of the third-party tools features add, as in the root package.json of the monorepo. */
const TOOL_VERSIONS: Record<string, string> = {
	prettier: '^3.9.10',
	'@ianvs/prettier-plugin-sort-imports': '^4.7.1'
};

/**
 * The version range written to the `package.json` of a new project for a package: the `^` range
 * of the Styx version for `@elysiumjs/*`, a known range for the tools features add.
 * @author Axel Nana <axel.nana@workbud.com>
 * @param name The package name.
 * @throws When no version is known for the package.
 */
export const versionFor = (name: string): string => {
	if (name.startsWith('@elysiumjs/')) return `^${version}`;
	const range = TOOL_VERSIONS[name];
	if (!range) throw new Error(`No version is known for ${name}.`);
	return range;
};

export const getModuleCode = (module: string) => /* js */ `import { Module } from '@elysiumjs/core';

@Module.register({
	controllers: []
})
export class ${module}Module extends Module {}
`;

/**
 * A runtime the generated app can run on.
 */
export type RuntimeChoice = {
	/** The prompt label. */
	title: string;

	/** The prompt hint. */
	description: string;

	/** The package exporting the runtime as `runtime`. */
	package: string;

	/** The local name the app imports `runtime` as. */
	alias: string;

	/** Why the runtime cannot be picked yet, when it cannot. */
	unavailable?: string;
};

/**
 * The runtimes offered by the runtime step, by prompt value.
 */
export const RUNTIMES: Record<'bun' | 'node' | 'workers', RuntimeChoice> = {
	bun: {
		title: 'Bun',
		description: 'Run with Bun (https://bun.sh)',
		package: '@elysiumjs/runtime-bun',
		alias: 'bunRuntime'
	},
	node: {
		title: 'Node.js',
		description: 'Run with Node.js (https://nodejs.org)',
		package: '@elysiumjs/runtime-node',
		alias: 'nodeRuntime',
		unavailable:
			'The Postgres, Redis and CLI packages the templates use still need Bun, and Node.js cannot run decorators without a build step.'
	},
	workers: {
		title: 'Cloudflare Workers',
		description: 'Deploy to Cloudflare Workers (https://workers.cloudflare.com)',
		package: '@elysiumjs/runtime-workers',
		alias: 'workersRuntime',
		unavailable:
			'The templates use Postgres and Redis clients that need Bun. A Worker can be set up by hand with createWorker() from @elysiumjs/runtime-workers and built with styx build --target workers.'
	}
};

/**
 * A module added to the generated app by a plugin or a feature.
 */
export type EnabledModule = {
	/** The package to import the module from. */
	name: string;

	/** The exported name of the module. */
	import: string;

	/** The expression to put in the app's `modules` list. */
	expression: string;
};

export const getAppCode = (
	projectName: string,
	modules: Record<string, string>,
	enabledModules: EnabledModule[] = [],
	runtime: RuntimeChoice = RUNTIMES.bun
) => /* js */ `import type { ServerError } from '@elysiumjs/core';

import { Application, Service, t } from '@elysiumjs/core';
import { HermesLogger, HermesModule } from '@elysiumjs/hermes';
import { RedisModule } from '@elysiumjs/redis';
import { runtime as ${runtime.alias} } from '${runtime.package}';
import { DrizzleModule } from '@elysiumjs/mnemosyne-drizzle';
${enabledModules.map((module) => `import { ${module.import} } from '${module.name}';`).join('\n')}

${Object.keys(modules)
	.map((module) => `import { ${pascal(module)}Module } from '${modules[module]}';`)
	.join('\n')}

export const env = t.Object({});

@Application.register({
	runtime: ${runtime.alias},
	modules: [
		HermesModule.with({ level: 'debug', format: 'pretty' }),
		RedisModule.with({
			default: 'cache',
			connections: {
				cache: { url: process.env.REDIS_URL! }
			}
		}),
		DrizzleModule.with(() => ({
			default: 'main',
			connections: {
				main: { connection: process.env.DATABASE_URL! }
			}
		})),
		${enabledModules.map((module) => `${module.expression},\n\t\t`).join('')}${Object.keys(modules)
			.map((module) => `${pascal(module)}Module`)
			.join(',\n\t\t')}
	],
	server: {
		name: '${projectName}',
		port: parseInt(process.env.PORT!, 10) || 3000
	},
	debug: false,
	openapi: {
		path: '/docs',
		documentation: {
			info: {
				title: '${projectName}',
				description: '${projectName} API Documentation',
				version: '1.0.0'
			}
		}
	},
	env
})
export class App extends Application {
	protected onError(e: ServerError): Promise<boolean> {
		Service.get(HermesLogger)?.error(e.error.message, e.error);
		return super.onError(e);
	}
}
`;
