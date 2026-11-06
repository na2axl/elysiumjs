import type { LifecycleEvent } from '@elysiumjs/core';

import { Lifecycle } from '@elysiumjs/core';

import { App } from './src/app';

Lifecycle.on('elysium:error', (e: LifecycleEvent<Error>) => {
	console.error(JSON.stringify(e));
});

await App.start();
