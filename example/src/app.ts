import type { ErrorContext } from 'elysia';

import { Application, Middleware, RedisModule, Service, WampModule } from '@elysiumjs/core';
import { HeraclesModule, RedisTransport } from '@elysiumjs/heracles';
import { HermesLogger, HermesModule } from '@elysiumjs/hermes';
import { DrizzleModule } from '@elysiumjs/mnemosyne-drizzle';
import { StyxModule } from '@elysiumjs/styx';

import { MainModule } from '#hero/hero.module';
import { XServerMiddleware } from '#hero/middlewares/x-server.middleware';

@Middleware.register(XServerMiddleware)
@Application.register({
	modules: [
		HermesModule.with({ level: 'debug', format: 'pretty' }),
		RedisModule.with({
			default: 'cache',
			connections: {
				cache: { url: process.env.REDIS_URL! }
			}
		}),
		WampModule.with({
			default: 'main',
			connections: {
				main: { url: process.env.WAMP_URL!, realm: 'realm1' }
			}
		}),
		DrizzleModule.with(() => ({
			default: 'main',
			connections: {
				main: { connection: process.env.DATABASE_URL! }
			}
		})),
		HeraclesModule.with({
			queues: {
				email: { transport: RedisTransport }
			}
		}),
		StyxModule,
		MainModule
	],
	server: {
		name: 'App',
		port: parseInt(process.env.PORT!, 10) || 3000
	},
	debug: false,
	swagger: {
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
	protected onError(e: ErrorContext): Promise<boolean> {
		Service.get(HermesLogger)?.error(e.error.message, e.error);
		return super.onError(e);
	}
}
