import type { LifecycleEvent } from '@elysiumjs/olympus';

import { Lifecycle } from '@elysiumjs/olympus';

import { App } from './src/app';

Lifecycle.on('elysium:error', (e: LifecycleEvent<Error>) => {
	console.error(JSON.stringify(e));
});

await App.start();
