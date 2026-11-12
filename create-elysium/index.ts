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
// limitations under the License.

/**
 * `bun create elysium` runs `styx create`: the project templates and prompts live in
 * `@elysiumjs/styx`, which also installs as a global command (`bun add -g @elysiumjs/styx`).
 */
const cli = Bun.resolveSync('@elysiumjs/styx/dist/cli.js', import.meta.dir);

const proc = Bun.spawn([process.execPath, cli, 'create', ...process.argv.slice(2)], {
	stdio: ['inherit', 'inherit', 'inherit']
});

process.exit(await proc.exited);
