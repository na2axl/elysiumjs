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

/**
 * This lane runs Elysia's just-in-time compiled handlers, built from strings through the Vitest
 * integration's `unsafeEval`. The workerd AOT lane (`vitest.workerd-aot.config.ts`) runs the same
 * scenarios as Workers compiled ahead of time by `elysia/plugin/aot`, without code generation.
 *
 * Setup of the workerd lane, run in the test isolate before each test file.
 *
 * 1. Elysia compiles its route handlers with `new Function(...params, body)`. The Vitest
 *    integration routes `new Function` to workerd's `unsafeEval`, which takes one name per
 *    parameter: Elysia passes some as one comma-separated string (`'rt,fre,c'`), and calls
 *    `Function` without `new` in places. This splits the names and treats a call as `new`.
 *    Deployed Workers compile ahead of time with `elysia/plugin/aot` instead (see the workerd
 *    AOT lane).
 * 2. workerd emits `unhandledRejection` as soon as a promise rejects without a handler, and
 *    `rejectionHandled` when one is attached a few microtasks later, such as when an async
 *    function returns a rejected promise to an awaiting caller. Node.js only reports the
 *    rejections still unhandled once the microtasks have run. This defers Vitest's handlers to
 *    the next macrotask and drops the rejections handled by then, as Node.js would.
 */

const splitParams = (args: unknown[]): unknown[] => {
	const body = args.length > 0 ? args[args.length - 1] : '';
	const params = args
		.slice(0, -1)
		.flatMap((param) => String(param).split(','))
		.map((name) => name.trim())
		.filter((name) => name.length > 0);
	return [...params, body];
};

type RejectionListener = (reason: unknown, promise: Promise<unknown>) => void;

/** Wraps `Function` so that `unsafeEval` gets one name per parameter. */
const installFunctionShim = (): void => {
	globalThis.Function = new Proxy(globalThis.Function, {
		construct: (target, args) => Reflect.construct(target, splitParams(args)),
		apply: (target, _self, args) => Reflect.construct(target, splitParams(args))
	});
};

/** Reports a rejection to Vitest only when it is still unhandled on the next macrotask. */
const installRejectionShim = (): void => {
	const reporters = process.listeners('unhandledRejection') as RejectionListener[];
	const pending = new Map<Promise<unknown>, unknown>();

	for (const reporter of reporters) process.off('unhandledRejection', reporter);

	process.on('unhandledRejection', (reason: unknown, promise: Promise<unknown>) => {
		pending.set(promise, reason);
		setTimeout(() => {
			if (!pending.has(promise)) return;
			pending.delete(promise);
			for (const reporter of reporters) reporter(reason, promise);
		}, 0);
	});

	process.on('rejectionHandled', (promise: Promise<unknown>) => {
		pending.delete(promise);
	});
};

// Setup files run once per test file, in one isolate: install the shims once, so that `Function`
// is not wrapped twice and Vitest's reporters are not moved behind the deferral again.
const lane = globalThis as typeof globalThis & { __elysiumLaneShim?: boolean };
if (!lane.__elysiumLaneShim) {
	lane.__elysiumLaneShim = true;
	installFunctionShim();
	installRejectionShim();
}
