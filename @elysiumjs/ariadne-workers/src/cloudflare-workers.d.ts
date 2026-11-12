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

// The slice of `cloudflare:workers` this package uses, for its own type check. Apps get the full
// declarations from `@cloudflare/workers-types` or `wrangler types`.
declare module 'cloudflare:workers' {
	export abstract class DurableObject<Env = unknown> {
		protected ctx: DurableObjectStateLike;
		protected env: Env;
		constructor(ctx: DurableObjectStateLike, env: Env);
		alarm?(): void | Promise<void>;
	}

	export interface DurableObjectStateLike {
		storage: {
			get<T = unknown>(key: string): Promise<T | undefined>;
			put(entries: Record<string, unknown>): Promise<void>;
			delete(key: string): Promise<boolean>;
			deleteAll(): Promise<void>;
			setAlarm(scheduledTime: number): Promise<void>;
			deleteAlarm(): Promise<void>;
		};
	}
}
