import type { LifecycleEvent } from '@elysiumjs/core';

import { Lifecycle } from '@elysiumjs/core';
import { App } from '#root/app';

Lifecycle.on('elysium:error', (e: LifecycleEvent<Error>) => {
	console.error(JSON.stringify(e));
});

await App.start();
