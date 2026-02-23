import type { Context } from '@elysiumjs/core';

import { Middleware } from '@elysiumjs/core';

export class AuthMiddleware extends Middleware {
	public onBeforeHandle(ctx: Context) {
		if (ctx.path.startsWith('/docs')) {
			return;
		}

		if (ctx.headers.authorization !== 'Bearer secret') {
			throw ctx.status(401, { message: 'Unauthorized' });
		}
	}
}
