import { DrizzleModel, pgTable } from '@elysiumjs/mnemosyne-drizzle';
import { boolean, integer, uuid, varchar } from 'drizzle-orm/pg-core';

export const usersTable = pgTable('users', {
	id: uuid().primaryKey().defaultRandom(),
	name: varchar({ length: 255 }).notNull(),
	age: integer().notNull(),
	email: varchar({ length: 255 }).notNull().unique(),
	is_confirmed: boolean().default(false)
});

export class UserModel extends DrizzleModel(usersTable, { supportTenancy: true }) {}

export type User = typeof UserModel.$inferSelect;
export type UserInsert = typeof UserModel.$inferInsert;
export type UserUpdate = typeof UserModel.$inferUpdate;
