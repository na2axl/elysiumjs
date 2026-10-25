import type { EventData } from '@elysiumjs/core';

import { Event } from '@elysiumjs/core';

import { App } from '#root/app';

Event.on('elysium:error', (e: EventData<Error>) => {
	console.error(JSON.stringify(e));
});

await App.start();
