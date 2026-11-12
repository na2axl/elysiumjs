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

import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import { t } from 'elysia';

import { Application } from '../src/app';
import {
	ConflictingEnvironmentSchemaError,
	InvalidEnvironmentError,
	mergeEnvironmentSchemas,
	Secret,
	validateEnvironment
} from '../src/config';
import { Env, EnvironmentNotReadyError } from '../src/env';
import { Http } from '../src/http';
import { ConsoleLogger } from '../src/logger';
import { Module } from '../src/module';
import { buildModuleGraph } from '../src/module-graph';
import { Runtime } from '../src/runtime';
import { createTestingHttpApp } from '../src/testing';
import { testRuntime } from './test-runtime';

describe('validateEnvironment', () => {
	const schema = t.Object({
		PORT: t.Number(),
		DEBUG: t.Optional(t.Boolean()),
		REGION: t.String({ default: 'eu' }),
		API_KEY: Secret.schema(),
		HOST: t.String()
	});

	it('converts, applies defaults, drops unknown keys and wraps secrets', () => {
		const env = validateEnvironment(schema, {
			PORT: '8080',
			DEBUG: 'true',
			API_KEY: 'sk_live_123',
			HOST: 'localhost',
			PATH: '/usr/bin'
		});

		expect(env.PORT).toBe(8080);
		expect(env.DEBUG).toBe(true);
		expect(env.REGION).toBe('eu');
		expect(env.PATH).toBeUndefined();
		expect(env.API_KEY).toBeInstanceOf(Secret);
		expect((env.API_KEY as Secret).reveal()).toBe('sk_live_123');
	});

	it('does not write into the given object, which may stringify values like process.env', () => {
		const raw = new Proxy({ PORT: '1', API_KEY: 'k', HOST: 'h' } as Record<string, unknown>, {
			set: (target, key, value) => Reflect.set(target, key, String(value))
		});
		const env = validateEnvironment(schema, raw);
		expect(env.PORT).toBe(1);
		expect(env.REGION).toBe('eu');
		expect(raw.REGION).toBeUndefined();
	});

	it('lists every missing or invalid key in one error, without the values', () => {
		let error: InvalidEnvironmentError | undefined;
		try {
			validateEnvironment(schema, { PORT: 'not-a-port', API_KEY: 'sk_live_123' });
		} catch (e) {
			error = e as InvalidEnvironmentError;
		}

		expect(error).toBeInstanceOf(InvalidEnvironmentError);
		expect(error!.issues.map((i) => i.key).sort()).toEqual(['HOST', 'PORT']);
		expect(error!.message).toContain('HOST: is required');
		expect(error!.message).not.toContain('not-a-port');
		expect(error!.message).not.toContain('sk_live_123');
	});
});

describe('Secret', () => {
	const secret = new Secret('sk_live_123');

	it('never prints its value', () => {
		expect(String(secret)).toBe('[secret]');
		expect(`${secret}`).toBe('[secret]');
		expect(JSON.stringify({ secret })).toBe('{"secret":"[secret]"}');
		expect(Bun.inspect(secret)).not.toContain('sk_live_123');
	});

	it('does not leak through the console logger', () => {
		const lines: string[] = [];
		const spy = spyOn(console, 'info').mockImplementation((...args: unknown[]) => {
			lines.push(args.map((arg) => Bun.inspect(arg)).join(' '));
		});
		try {
			new ConsoleLogger().info('connecting', { key: secret });
		} finally {
			spy.mockRestore();
		}
		expect(lines.join('')).toContain('connecting');
		expect(lines.join('')).not.toContain('sk_live_123');
	});
});

describe('mergeEnvironmentSchemas', () => {
	it('merges the app schema with the schemas of the active modules', () => {
		@Module.register({ envSchema: t.Object({ MAIL_FROM: t.String() }) })
		class MailModule extends Module {}

		const merged = mergeEnvironmentSchemas(
			t.Object({ PORT: t.Number() }),
			buildModuleGraph([MailModule])
		);
		expect(Object.keys(merged!.properties).sort()).toEqual(['MAIL_FROM', 'PORT']);
	});

	it('refuses a key declared differently by two schemas', () => {
		@Module.register({ envSchema: t.Object({ PORT: t.String() }) })
		class OtherModule extends Module {}

		expect(() =>
			mergeEnvironmentSchemas(t.Object({ PORT: t.Number() }), buildModuleGraph([OtherModule]))
		).toThrow(ConflictingEnvironmentSchemaError);
	});

	it('accepts the same declaration twice', () => {
		@Module.register({ envSchema: t.Object({ PORT: t.Number() }) })
		class SameModule extends Module {}

		expect(() =>
			mergeEnvironmentSchemas(t.Object({ PORT: t.Number() }), buildModuleGraph([SameModule]))
		).not.toThrow();
	});
});

describe('environment at boot', () => {
	afterEach(() => {
		Runtime.use(testRuntime);
	});

	const withEnv = (env: Record<string, string>) => Runtime.use({ ...testRuntime, env: () => env });

	@Http.controller('/env')
	class EnvController {
		@Http.get()
		public show() {
			return { port: Env.get('PORT'), secret: String(Env.get('API_KEY')) };
		}
	}

	@Module.register({
		controllers: [EnvController],
		envSchema: t.Object({ API_KEY: Secret.schema() })
	})
	class EnvModule extends Module {}

	@Application.register({
		modules: [EnvModule],
		openapi: false,
		env: t.Object({ PORT: t.Number() })
	})
	class EnvApp extends Application {}

	it('validates the merged schemas when the app is built', async () => {
		withEnv({ PORT: '3000', API_KEY: 'sk_live_123' });
		const testing = await createTestingHttpApp({ app: EnvApp });
		const response = await testing.http.get('/env');

		expect(await response.json()).toEqual({ port: 3000, secret: '[secret]' });
		await testing.shutdown();
	});

	it('fails to build with every missing key listed', async () => {
		withEnv({});
		const error = await createTestingHttpApp({ app: EnvApp }).catch((e) => e);

		expect(error).toBeInstanceOf(InvalidEnvironmentError);
		expect(error.issues.map((i: { key: string }) => i.key).sort()).toEqual(['API_KEY', 'PORT']);
	});

	it('refuses to read the environment of an app with a schema before it is validated', async () => {
		withEnv({ PORT: '3000', API_KEY: 'sk_live_123' });
		const app = new EnvApp();

		expect(() => Env.get('PORT')).toThrow(EnvironmentNotReadyError);
		expect(() => Env.exists('PORT')).toThrow(EnvironmentNotReadyError);

		await app.build();
		expect(Env.get('PORT')).toBe(3000);
		await app.kernel.shutdown();
	});

	it('reads the raw environment of an app without a schema', () => {
		@Application.register({ openapi: false })
		class RawApp extends Application {}

		withEnv({ PORT: '3000' });
		new RawApp();

		expect(Env.get('PORT')).toBe('3000');
	});
});
