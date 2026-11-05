import '@elysiumjs/core';

declare module '@elysiumjs/core' {
	type AppEnv = typeof import('./src/app').env.static;
}
