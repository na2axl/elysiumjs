import type { Context } from '@elysiumjs/olympus';

import { Middleware } from '@elysiumjs/olympus';

export class XServerMiddleware extends Middleware {
	public onBeforeHandle(ctx: Context) {
		ctx.set.headers['X-Server'] = 'Elysium';
	}
}
