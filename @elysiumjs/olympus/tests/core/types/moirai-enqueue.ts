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

// Compile-time checks of Moirai.execute() and Moirai.enqueue(): run by `bun run typecheck`.
import type { QueuedAction } from '../../../src/moirai';

import { t } from '../../../src/index';
import { Action, Moirai } from '../../../src/moirai';

type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const assert = <T extends true>(): T => true as T;

@Action.register({ errors: [], input: t.Object({ name: t.String() }) })
class Greet extends Action<{ name: string }> {
	public handle(input: { name: string }) {
		return { greeted: input.name };
	}
}

@Action.register({ errors: [] })
class Ping extends Action {
	public handle() {
		return 'pong' as const;
	}
}

export const checks = async () => {
	const now = await Moirai.execute(Greet, { name: 'ada' }).orThrow();
	assert<Equal<typeof now, { greeted: string }>>();

	const queued = await Moirai.enqueue(Greet, { name: 'ada' }, { queue: 'mail' }).orThrow();
	assert<Equal<typeof queued, QueuedAction>>();

	// An action without input takes none, and queues without a call.
	assert<
		Equal<Awaited<ReturnType<ReturnType<typeof Moirai.execute<typeof Ping>>['orThrow']>>, 'pong'>
	>();
	await Moirai.enqueue(Ping).orThrow();

	// @ts-expect-error the input is required
	await Moirai.enqueue(Greet);
	// @ts-expect-error execute() takes no queue
	await Moirai.execute(Greet, { name: 'ada' }, { queue: 'mail' });
};
