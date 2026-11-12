// Copyright (c) 2026-present Axel Nana <ax.lnana@outlook.com>. All rights reserved.
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

import type { Env } from '@elysiumjs/core';

import { t } from '@elysiumjs/core';

/**
 * The environment variables of the Sentry module, validated at boot. Both are optional: the
 * module config can give them instead.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export const SentryEnv = t.Object({
	SENTRY_DSN: t.Optional(t.String({ description: 'The Sentry DSN, when the config has none.' })),
	SENTRY_ENVIRONMENT: t.Optional(
		t.String({ description: 'The Sentry environment, when the config has none.' })
	)
});

declare module '@elysiumjs/core' {
	interface AppEnv extends Env.Infer<typeof SentryEnv> {}
}
