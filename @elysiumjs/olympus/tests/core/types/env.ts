// Copyright (c) 2025-present Axel Nana <ax.lnana@outlook.com>. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// Compile-time checks: run by `bun run typecheck`, not by `bun test`.
import type { Secret } from '../../../src/config';

import { t } from 'elysia';

import { Secret as SecretClass } from '../../../src/config';
import { Env } from '../../../src/env';

const AppSchema = t.Object({
	PORT: t.Number({ default: 3000 }),
	APP_NAME: t.String(),
	DATABASE_URL: SecretClass.schema(),
	SENTRY_DSN: t.Optional(t.String()),
	API_KEY: t.Optional(SecretClass.schema())
});

const ModuleSchema = t.Object({ MEDIA_BUCKET: t.String() });

declare module '../../../src/env' {
	interface AppEnv extends Env.Infer<typeof AppSchema>, Env.Infer<typeof ModuleSchema> {}
}

export const port: number = Env.get('PORT');
export const name: string = Env.get('APP_NAME');
export const url: Secret<string> = Env.get('DATABASE_URL');
export const dsn: string | undefined = Env.get('SENTRY_DSN');
export const key: Secret<string> | undefined = Env.get('API_KEY');
export const bucket: string = Env.get('MEDIA_BUCKET');
export const withDefault: string = Env.get('SENTRY_DSN', 'https://dsn');
export const exists: boolean = Env.exists('MEDIA_BUCKET');

// @ts-expect-error a secret is not a string
export const leaked: string = Env.get('DATABASE_URL');
// @ts-expect-error an optional variable may be missing
export const required: string = Env.get('SENTRY_DSN');
// @ts-expect-error unknown variable
Env.get('MEDIA_BUKET');
// @ts-expect-error unknown variable
Env.exists('NOPE');
// @ts-expect-error the default has the variable's type
Env.get('PORT', '3000');
