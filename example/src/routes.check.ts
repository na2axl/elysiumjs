// Type checks of the generated route types: `bun run typecheck` fails when a response, parameter or
// body type is not inferred through Eden. This file is never run.
import type { User, UserInsert } from '#hero/models/user.model';
import type { AppRoutes } from './routes.gen';

import { treaty } from '@elysia/eden';

type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const expect = <T extends true>(): T => true as T;

const api = treaty<AppRoutes>('http://localhost:3000');
declare const user: UserInsert;

export const checks = async () => {
	const list = await api.users.get();
	expect<Equal<typeof list.data, User[] | null>>();

	const one = await api.users({ id: 'b5f7e5a2-0000-4000-8000-000000000000' }).get();
	expect<Equal<typeof one.data, User | null>>();

	const created = await api.users.post(user);
	expect<Equal<typeof created.data, UserInsert | null>>();

	const patched = await api.users.patch(user);
	expect<Equal<typeof patched.data, UserInsert | null>>();

	const removed = await api.users.delete();
	expect<Equal<typeof removed.data, User[] | null>>();

	const events = await api.users({ id: 'x' }).notifications.get({ query: {} });
	expect<Equal<NonNullable<typeof events.data>['event'], string>>();

	// @ts-expect-error the body must be a user
	await api.users.post({ name: 1 });
};
