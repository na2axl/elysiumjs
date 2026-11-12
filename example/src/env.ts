import type { Env } from '@elysiumjs/olympus';

import { Secret, t } from '@elysiumjs/olympus';

/** The environment variables of the app, validated at boot and read with `Env.get()`. */
export const env = t.Object({
	PORT: t.Number({ default: 3000 }),
	DATABASE_URL: Secret.schema(),
	REDIS_URL: Secret.schema(),
	WAMP_URL: t.String()
});

declare module '@elysiumjs/olympus' {
	interface AppEnv extends Env.Infer<typeof env> {}
}
