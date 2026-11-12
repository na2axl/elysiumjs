#!/usr/bin/env bun
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

/** Stands for a class of `cloudflare:workers` while Styx imports the app's code. */
class ToolingStub {}

/**
 * The `cloudflare:*` modules, which only workerd provides. Styx imports the app's code in Bun to
 * read it (its routes, its commands), so an app that exports a Durable Object, or imports a
 * package that does, would fail to load. Classes and functions that do nothing stand for their
 * exports there; nothing of them runs.
 */
const CLOUDFLARE_STUBS: Record<string, Record<string, unknown>> = {
	'cloudflare:workers': {
		DurableObject: ToolingStub,
		WorkerEntrypoint: ToolingStub,
		WorkflowEntrypoint: ToolingStub,
		RpcTarget: ToolingStub,
		RpcStub: ToolingStub,
		env: {},
		waitUntil: () => {}
	},
	'cloudflare:email': { EmailMessage: ToolingStub },
	'cloudflare:sockets': { connect: () => ({}) }
};

/** Registers the `cloudflare:*` stand-ins with Bun's runtime. */
export const stubCloudflareModules = (): void => {
	Bun.plugin({
		name: 'styx-cloudflare-stubs',
		setup(build) {
			for (const [specifier, exports] of Object.entries(CLOUDFLARE_STUBS)) {
				build.module(specifier, () => ({ exports, loader: 'object' }));
			}
		}
	});
};
