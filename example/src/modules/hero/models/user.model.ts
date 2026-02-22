import { DrizzleModel } from '@elysiumjs/mnemosyne-drizzle';
import { boolean, integer, uuid, varchar } from 'drizzle-orm/pg-core';

export class UserModel extends DrizzleModel('users', {
	id: uuid().primaryKey().defaultRandom(),
	name: varchar({ length: 255 }).notNull(),
	age: integer().notNull(),
	email: varchar({ length: 255 }).notNull().unique(),
	is_confirmed: boolean().default(false)
}) {
	public static readonly supportTenancy = true;
}

export type User = typeof UserModel.$inferSelect;
export type UserInsert = typeof UserModel.$inferInsert;
export type UserUpdate = typeof UserModel.$inferUpdate;
