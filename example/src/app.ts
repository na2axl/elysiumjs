import type { ServerError } from '@elysiumjs/olympus';

import { DrizzleModule } from '@elysiumjs/mnemosyne-drizzle';
import { Application, Env, Middleware, Service, WampModule } from '@elysiumjs/olympus';
import { HeraclesModule } from '@elysiumjs/olympus/heracles';
import { HermesLogger, HermesModule } from '@elysiumjs/olympus/hermes';
import { HeraclesRedisModule, RedisModule, RedisTransport } from '@elysiumjs/redis';
import { runtime as bunRuntime } from '@elysiumjs/runtime-bun';
import { StyxModule } from '@elysiumjs/styx';

import { MainModule } from '#hero/hero.module';
import { XServerMiddleware } from '#hero/middlewares/x-server.middleware';

import { env } from './env';

@Middleware.register(XServerMiddleware)
@Application.register({
	runtime: bunRuntime,
	modules: [
		HermesModule.with({ level: 'debug', format: 'pretty' }),
		RedisModule.with(() => ({
			default: 'cache',
			connections: {
				cache: { url: Env.get('REDIS_URL').reveal() }
			}
		})),
		WampModule.with(() => ({
			default: 'main',
			connections: {
				main: { url: Env.get('WAMP_URL'), realm: 'realm1' }
			}
		})),
		DrizzleModule.with(() => ({
			default: 'main',
			connections: {
				main: { connection: Env.get('DATABASE_URL').reveal() }
			}
		})),
		HeraclesModule.with({
			queues: {
				email: { transport: RedisTransport }
			}
		}),
		HeraclesRedisModule,
		StyxModule,
		MainModule
	],
	server: {
		name: 'App'
	},
	debug: false,
	env,
	openapi: {
		path: '/docs',
		documentation: {
			info: {
				title: 'Elysium',
				description: 'Elysium API Documentation',
				version: '1.0.0'
			}
		}
	}
})
export class App extends Application {
	protected onError(e: ServerError): Promise<boolean> {
		Service.get(HermesLogger)?.error(e.error.message, e.error);
		return super.onError(e);
	}
}
