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

import { elysiumVersions } from './versions' with { type: 'macro' };

/** The ranges of the third-party tools features add, as in the root package.json of the monorepo. */
const TOOL_VERSIONS: Record<string, string> = {
	prettier: '^3.9.10',
	'@ianvs/prettier-plugin-sort-imports': '^4.7.1',
	typescript: '^7.0.2',
	'drizzle-kit': '^1.0.0-rc.5',
	postgres: '^3.4.7',
	ioredis: '^5.8.2',
	'@types/bun': '^1.3.1',
	'@types/node': '^24.10.0',
	'@cloudflare/workers-types': '^4.20251101.0',
	wrangler: '^4.158.0'
};

/** The versions of the `@elysiumjs/*` packages Styx was released with. */
const ELYSIUM_VERSIONS = elysiumVersions();

/**
 * The version range written to the `package.json` of a new project for a package: a caret range
 * on the version released with Styx for `@elysiumjs/*` (each package has its own version), a
 * known range for the tools features add.
 * @author Axel Nana <axel.nana@workbud.com>
 * @param name The package name.
 * @throws When no version is known for the package.
 */
export const versionFor = (name: string): string => {
	const elysium = ELYSIUM_VERSIONS[name];
	if (elysium) return `^${elysium}`;
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

	/** The `types` of the generated tsconfig. */
	types: string[];

	/** The development packages the runtime needs. */
	devPackages: string[];
};

/**
 * The runtimes offered by the runtime step, by prompt value.
 */
export const RUNTIMES: Record<'bun' | 'node' | 'workers', RuntimeChoice> = {
	bun: {
		title: 'Bun',
		description: 'Run with Bun (https://bun.sh)',
		package: '@elysiumjs/runtime-bun',
		alias: 'bunRuntime',
		types: ['bun'],
		devPackages: ['@types/bun']
	},
	node: {
		title: 'Node.js',
		description: 'Run with Node.js (https://nodejs.org), built with styx build --target node',
		package: '@elysiumjs/runtime-node',
		alias: 'nodeRuntime',
		types: ['node'],
		devPackages: ['@types/node']
	},
	workers: {
		title: 'Cloudflare Workers',
		description: 'Deploy to Cloudflare Workers (https://workers.cloudflare.com)',
		package: '@elysiumjs/runtime-workers',
		alias: 'workersRuntime',
		types: ['@cloudflare/workers-types', 'node'],
		devPackages: ['@cloudflare/workers-types', '@types/node', 'wrangler']
	}
};

/**
 * The parts of the generated app that can be left out.
 */
export type AppParts = {
	/** A PostgreSQL connection through `@elysiumjs/mnemosyne-drizzle`. */
	database: boolean;

	/** A Redis connection through `@elysiumjs/redis`. */
	cache: boolean;
};

/**
 * The packages the app of a runtime needs for its parts.
 * @author Axel Nana <axel.nana@workbud.com>
 * @param runtime The runtime key.
 * @param parts The parts of the app.
 */
export const appPackages = (
	runtime: keyof typeof RUNTIMES,
	parts: AppParts
): { prod: string[]; dev: string[] } => {
	const prod = ['@elysiumjs/core', '@elysiumjs/hermes', RUNTIMES[runtime].package];
	const dev = ['@elysiumjs/styx', 'typescript', ...RUNTIMES[runtime].devPackages];
	if (parts.database) {
		prod.push('@elysiumjs/mnemosyne-drizzle');
		dev.push('drizzle-kit');
		if (runtime !== 'bun') prod.push('postgres');
	}
	if (parts.cache) {
		prod.push('@elysiumjs/redis');
		if (runtime === 'node') prod.push('ioredis');
	}
	return { prod, dev };
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

/** The imports and the module entries of the database and the cache, per runtime. */
const partCode = (runtime: keyof typeof RUNTIMES, parts: AppParts) => {
	const imports: string[] = [];
	const modules: string[] = [];
	if (parts.cache) {
		if (runtime === 'bun') {
			imports.push("import { RedisModule } from '@elysiumjs/redis';");
			modules.push(`RedisModule.with(() => ({
			default: 'cache',
			connections: { cache: { url: Env.get('REDIS_URL').reveal() } }
		}))`);
		} else if (runtime === 'node') {
			imports.push("import { ioredis, RedisModule } from '@elysiumjs/redis';");
			imports.push("import IORedis from 'ioredis';");
			modules.push(`RedisModule.with(() => ({
			default: 'cache',
			client: ioredis((url, options) => new IORedis(url, { ...options, lazyConnect: true })),
			connections: { cache: { url: Env.get('REDIS_URL').reveal() } }
		}))`);
		} else {
			imports.push("import { RedisModule, upstash } from '@elysiumjs/redis';");
			modules.push(`RedisModule.with(() => ({
			default: 'cache',
			client: upstash({ token: Env.get('UPSTASH_REDIS_REST_TOKEN').reveal() }),
			connections: { cache: { url: Env.get('UPSTASH_REDIS_REST_URL') } }
		}))`);
		}
	}
	if (parts.database) {
		imports.push("import { DrizzleModule } from '@elysiumjs/mnemosyne-drizzle';");
		if (runtime === 'bun') {
			modules.push(`DrizzleModule.with(() => ({
			default: 'main',
			connections: { main: { connection: Env.get('DATABASE_URL').reveal() } }
		}))`);
		} else if (runtime === 'node') {
			imports.push("import { postgresJs } from '@elysiumjs/mnemosyne-drizzle/postgres-js';");
			modules.push(`DrizzleModule.with(() => ({
			default: 'main',
			connections: { main: { driver: postgresJs({ connection: Env.get('DATABASE_URL').reveal() }) } }
		}))`);
		} else {
			imports.push("import { hyperdrive } from '@elysiumjs/mnemosyne-drizzle/hyperdrive';");
			imports.push("import { postgresJs } from '@elysiumjs/mnemosyne-drizzle/postgres-js';");
			modules.push(`DrizzleModule.with(() => ({
			default: 'main',
			connections: {
				main: {
					driver: hyperdrive({
						binding: 'HYPERDRIVE',
						driver: (url) => postgresJs({ connection: { url, max: 5, fetch_types: false } })
					})
				}
			}
		}))`);
		}
	}
	return { imports, modules };
};

export const getAppCode = (
	projectName: string,
	modules: Record<string, string>,
	enabledModules: EnabledModule[] = [],
	runtime: keyof typeof RUNTIMES = 'bun',
	parts: AppParts = { database: true, cache: true }
) => {
	const choice = RUNTIMES[runtime];
	const part = partCode(runtime, parts);
	const hermes =
		runtime === 'workers'
			? "HermesModule.with({ level: 'debug', transport: 'console' })"
			: "HermesModule.with({ level: 'debug', format: 'pretty' })";
	const entries = [
		hermes,
		...part.modules,
		...enabledModules.map((module) => module.expression),
		...Object.keys(modules).map((module) => `${pascal(module)}Module`)
	];
	return /* js */ `import type { ServerError } from '@elysiumjs/core';

import { Application, ${parts.database || parts.cache ? 'Env, ' : ''}getLogger } from '@elysiumjs/core';
import { HermesModule } from '@elysiumjs/hermes';
import { runtime as ${choice.alias} } from '${choice.package}';
${[...part.imports, ...enabledModules.map((module) => `import { ${module.import} } from '${module.name}';`)].join('\n')}

${Object.keys(modules)
	.map((module) => `import { ${pascal(module)}Module } from '${modules[module]}';`)
	.join('\n')}
import { env } from './env';

@Application.register({
	runtime: ${choice.alias},
	modules: [
		${entries.join(',\n\t\t')}
	],
	server: {
		name: '${projectName}'
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
		getLogger().error(e.error.message, { error: e.error });
		return super.onError(e);
	}
}
`;
};

/**
 * The environment schema of a project, with the declaration that types `Env.get()` from it. A
 * `.ts` file, so that the compiler checks it even with `skipLibCheck`.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export const getEnvCode = (
	runtime: keyof typeof RUNTIMES = 'bun',
	parts: AppParts = { database: true, cache: true }
) => {
	const variables: string[] = [];
	// A Worker does not listen on a port.
	if (runtime !== 'workers') variables.push('PORT: t.Number({ default: 3000 })');
	// On Workers, the database goes through the Hyperdrive binding.
	if (parts.database && runtime !== 'workers') variables.push('DATABASE_URL: Secret.schema()');
	if (parts.cache) {
		if (runtime === 'workers') {
			variables.push(
				'UPSTASH_REDIS_REST_URL: t.String()',
				'UPSTASH_REDIS_REST_TOKEN: Secret.schema()'
			);
		} else {
			variables.push('REDIS_URL: Secret.schema()');
		}
	}
	const secret = variables.some((variable) => variable.includes('Secret.schema()'));
	return /* js */ `import type { Env } from '@elysiumjs/core';

import { ${secret ? 'Secret, ' : ''}t } from '@elysiumjs/core';

/**
 * The environment variables of the app, validated at boot and read with \`Env.get()\`. Modules
 * declare theirs in their own \`envSchema\` the same way.
 */
export const env = t.Object({${variables.length ? `\n\t${variables.join(',\n\t')}\n` : ''}});

declare module '@elysiumjs/core' {
	interface AppEnv extends Env.Infer<typeof env> {}
}
`;
};

/**
 * The scripts of a project, per runtime and package manager.
 * @author Axel Nana <axel.nana@workbud.com>
 * @param runtime The runtime key.
 */
export const getScripts = (runtime: keyof typeof RUNTIMES): Record<string, string> => {
	const common = {
		routes: 'styx routes:generate',
		typecheck: 'styx routes:generate && tsc --noEmit'
	};
	if (runtime === 'node') {
		return {
			build: 'styx build --target node --entry ./index.ts',
			start: 'node --enable-source-maps dist/server.js serve',
			dev: 'styx build --target node --entry ./index.ts && node --enable-source-maps dist/server.js serve',
			...common
		};
	}
	if (runtime === 'workers') {
		return {
			build: 'styx build --target workers',
			dev: 'styx build --target workers && wrangler dev',
			deploy: 'styx build --target workers && wrangler deploy',
			...common
		};
	}
	return { dev: 'bun --watch styx serve', ...common };
};

/** The Worker entry of a Cloudflare Workers project. */
export const getWorkerCode =
	() => /* js */ `import { createWorker } from '@elysiumjs/runtime-workers';

import { App } from '#root/app';

const worker = await createWorker(new App());

// The AOT plugin of styx build --target workers compiles the routes of the exported app.
export const app = worker.app;

export default worker;
`;

/**
 * The wrangler config of a Cloudflare Workers project.
 * @author Axel Nana <axel.nana@workbud.com>
 * @param projectName The project name.
 * @param parts The parts of the app, for the bindings they need.
 */
export const getWranglerConfig = (projectName: string, parts: AppParts) => {
	const config: Record<string, unknown> = {
		$schema: 'node_modules/wrangler/config-schema.json',
		name: projectName.replace(/^@[^/]+\//, ''),
		main: 'dist/worker.js',
		compatibility_date: '2026-10-01',
		compatibility_flags: ['nodejs_compat'],
		observability: { enabled: true }
	};
	if (parts.database) {
		config.hyperdrive = [
			{
				binding: 'HYPERDRIVE',
				id: '<your-hyperdrive-id>',
				localConnectionString: `postgres://postgres:postgres@localhost:5432/${config.name}`
			}
		];
	}
	return JSON.stringify(config, null, '\t') + '\n';
};
