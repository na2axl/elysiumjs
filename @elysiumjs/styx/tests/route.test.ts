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

import { describe, expect, it } from 'bun:test';

import { isCliCommand, isGenerator, route } from '../src/cli/route';

const self = '/global/styx/dist/cli.js';
const local = '/app/node_modules/@elysiumjs/styx/dist/cli.js';

describe('route', () => {
	it('prints the version anywhere', () => {
		for (const flag of ['--version', '-v', 'version']) {
			expect(route([flag], { self })).toEqual({ kind: 'version' });
		}
	});

	it('runs create outside a project, with a positional name', () => {
		expect(route(['create', 'my-app', '--template', 'multi'], { self })).toEqual({
			kind: 'cli',
			argv: ['create', '--name', 'my-app', '--template', 'multi']
		});
		expect(route(['new', '--name', 'my-app'], { self })).toEqual({
			kind: 'cli',
			argv: ['create', '--name', 'my-app']
		});
	});

	it('runs create inside a project without handing off', () => {
		expect(route(['create', 'x'], { project: '/app', projectCli: local, self })).toEqual({
			kind: 'cli',
			argv: ['create', '--name', 'x']
		});
	});

	it('lists the commands outside a project', () => {
		expect(route([], { self })).toEqual({ kind: 'cli', argv: [] });
		expect(route(['list'], { self })).toEqual({ kind: 'cli', argv: ['list'] });
	});

	it('refuses generators and app commands outside a project', () => {
		expect(route(['make:service', '--name', 'A'], { self })).toMatchObject({ kind: 'error' });
		const serve = route(['serve'], { self });
		expect(serve).toMatchObject({ kind: 'error' });
		expect((serve as { message: string }).message).toContain('styx create');
	});

	it("hands off to the project's own Styx", () => {
		expect(route(['serve'], { project: '/app', projectCli: local, self })).toEqual({
			kind: 'handoff',
			cli: local,
			argv: ['serve']
		});
		expect(
			route(['make:job', '--name', 'A'], { project: '/app', projectCli: local, self })
		).toEqual({ kind: 'handoff', cli: local, argv: ['make:job', '--name', 'A'] });
	});

	it('runs generators itself when the project has no Styx', () => {
		expect(route(['make:service', '--name', 'A'], { project: '/app', self })).toEqual({
			kind: 'cli',
			argv: ['make:service', '--name', 'A']
		});
	});

	it('asks to install Styx for app tools when the project has none', () => {
		for (const command of ['routes:generate', 'hephaestus:build']) {
			const result = route([command], { project: '/app', self });
			expect(result).toMatchObject({ kind: 'error' });
		}
		expect(route(['routes:generate'], { self })).toMatchObject({ kind: 'error' });
		expect(route(['routes:generate'], { project: '/app', projectCli: local, self: local })).toEqual(
			{ kind: 'cli', argv: ['routes:generate'] }
		);
	});

	it('asks to install Styx for app commands when the project has none', () => {
		const result = route(['serve'], { project: '/app', self });
		expect(result).toMatchObject({ kind: 'error' });
		expect((result as { message: string }).message).toContain('bun add -D @elysiumjs/styx');
	});

	it('runs app commands in the project when it is the project Styx', () => {
		expect(route(['serve'], { project: '/app', projectCli: local, self: local })).toEqual({
			kind: 'app',
			project: '/app',
			argv: ['serve']
		});
		expect(
			route(['hephaestus:build'], { project: '/app', projectCli: local, self: local })
		).toEqual({ kind: 'cli', argv: ['hephaestus:build'] });
	});

	it('runs build as hephaestus:build in the project Styx', () => {
		expect(
			route(['build', '--target', 'workers'], { project: '/app', projectCli: local, self: local })
		).toEqual({ kind: 'cli', argv: ['hephaestus:build', '--target', 'workers'] });
		expect(route(['build'], { project: '/app', self })).toMatchObject({ kind: 'error' });
		expect(isCliCommand('build')).toBe(true);
	});
});

describe('command kinds', () => {
	it('tells generators and build tools apart', () => {
		expect(isGenerator('make:model')).toBe(true);
		expect(isGenerator('module:new')).toBe(true);
		expect(isGenerator('serve')).toBe(false);
		expect(isGenerator(undefined)).toBe(false);
		expect(isCliCommand('hephaestus:build')).toBe(true);
		expect(isCliCommand('make:job')).toBe(true);
		expect(isCliCommand('routes:generate')).toBe(true);
		expect(isCliCommand('work')).toBe(false);
	});
});
