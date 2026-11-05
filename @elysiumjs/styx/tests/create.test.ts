// Copyright (c) 2026-present Workbud Technologies Inc. All rights reserved.
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

import type { CreateOptions } from '../src/create/create.command';

import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { listAssets, readAsset, useEmbeddedAssets } from '../src/assets';
import { createProject } from '../src/create/create.command';
import { InvalidNameError } from '../src/create/names';

const defaults = (overrides: Partial<CreateOptions> = {}): CreateOptions => ({
	name: 'my-app',
	path: '.',
	template: 'single',
	runtime: 'bun',
	modules: [],
	plugins: [],
	features: [],
	git: false,
	install: false,
	force: false,
	...overrides
});

describe('createProject', () => {
	let dir: string;
	const commands: string[][] = [];
	const exec = async (_cwd: string, command: string[]) => {
		commands.push(command);
	};

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), 'styx-create-'));
		commands.length = 0;
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it('writes a single module project', async () => {
		const path = await createProject(defaults({ path: dir }), exec);

		expect(path).toBe(join(dir, 'my-app'));
		for (const file of ['.gitignore', 'package.json', 'src/app.ts', 'src/main.module.ts']) {
			expect(existsSync(join(path, file))).toBe(true);
		}
		expect(existsSync(join(path, 'src', 'services'))).toBe(true);
		expect(existsSync(join(path, 'src', 'services', '.gitkeep'))).toBe(false);

		const rc = await Bun.file(join(path, '.elysiumrc')).json();
		expect(rc).toEqual({ projectName: 'my-app', mono: true });

		const pkg = await Bun.file(join(path, 'package.json')).json();
		expect(pkg.name).toBe('my-app');
		expect(pkg.imports).toEqual({ '#root/*': './src/*.ts' });

		const app = await Bun.file(join(path, 'src', 'app.ts')).text();
		expect(app).toContain("from '@elysiumjs/runtime-bun'");
		expect(app).toContain("from '#root/main.module'");
		expect(app).not.toContain('StyxModule');
		expect(commands).toEqual([]);
	});

	it('writes .gitignore from the packaged gitignore', async () => {
		const path = await createProject(defaults({ path: dir }), exec);

		expect(existsSync(join(path, '.gitignore'))).toBe(true);
		expect(existsSync(join(path, 'gitignore'))).toBe(false);
	});

	it('declares every dependency when install is false', async () => {
		const path = await createProject(
			defaults({ path: dir, plugins: ['sentry'], features: ['prettier'] }),
			exec
		);
		const pkg = await Bun.file(join(path, 'package.json')).json();

		expect(pkg.dependencies['@elysiumjs/runtime-bun']).toMatch(/^\^\d/);
		expect(pkg.dependencies['@elysiumjs/plugin-sentry']).toMatch(/^\^\d/);
		expect(pkg.devDependencies).toHaveProperty('prettier');
		expect(commands).toEqual([]);
	});

	it('writes a multi module project with features', async () => {
		const path = await createProject(
			defaults({
				path: dir,
				template: 'multi',
				modules: ['users', 'billing'],
				features: ['prettier', 'hephaestus'],
				install: true,
				git: true
			}),
			exec
		);

		expect(existsSync(join(path, 'src', 'modules', 'users', 'users.module.ts'))).toBe(true);
		expect(existsSync(join(path, 'src', 'modules', 'billing', 'billing.module.ts'))).toBe(true);
		expect(existsSync(join(path, '.prettierrc'))).toBe(true);
		expect(existsSync(join(path, 'hephaestus.config.ts'))).toBe(true);
		expect(existsSync(join(path, '.specs'))).toBe(false);

		const rc = await Bun.file(join(path, '.elysiumrc')).json();
		expect(rc.modules).toEqual({ users: 'src/modules/users', billing: 'src/modules/billing' });

		const pkg = await Bun.file(join(path, 'package.json')).json();
		expect(pkg.imports['#users/*']).toBe('./src/modules/users/*.ts');

		const app = await Bun.file(join(path, 'src', 'app.ts')).text();
		expect(app).not.toContain('HephaestusModule');

		expect(commands).toEqual([
			['bun', 'install'],
			['bun', 'run', 'format'],
			['git', 'init']
		]);
	});

	it('refuses a folder that is not empty unless forced', async () => {
		await Bun.write(join(dir, 'my-app', 'keep.txt'), 'x');
		await expect(createProject(defaults({ path: dir }), exec)).rejects.toThrow('not empty');

		await createProject(defaults({ path: dir, force: true }), exec);
		expect(existsSync(join(dir, 'my-app', 'keep.txt'))).toBe(false);
	});

	it('refuses unknown or unavailable choices', async () => {
		await expect(createProject(defaults({ path: dir, runtime: 'workers' }), exec)).rejects.toThrow(
			'not available yet'
		);
		await expect(
			createProject(defaults({ path: dir, template: 'nope' as 'single' }), exec)
		).rejects.toThrow('Unknown template');
		await expect(createProject(defaults({ path: dir, features: ['nope'] }), exec)).rejects.toThrow(
			'Unknown feature'
		);
	});

	describe('names and paths', () => {
		it('refuses absolute, dot and parent names before touching the disk', async () => {
			const project = join(dir, 'inner');
			await mkdir(project, { recursive: true });
			await Bun.write(join(project, 'keep.txt'), 'keep');
			await Bun.write(join(dir, 'keep.txt'), 'keep');

			for (const name of [join(dir, 'abs'), '.', '..', '../sibling', '@scope/../x']) {
				await expect(
					createProject(defaults({ name, path: project, force: true }), exec)
				).rejects.toBeInstanceOf(InvalidNameError);
			}

			expect(existsSync(join(project, 'keep.txt'))).toBe(true);
			expect(existsSync(join(dir, 'keep.txt'))).toBe(true);
		});

		it('refuses upper-case project names', async () => {
			await expect(createProject(defaults({ name: 'MyApp', path: dir }), exec)).rejects.toThrow(
				'Invalid project name "MyApp"'
			);
		});

		it('refuses invalid module names without writing outside src/modules', async () => {
			for (const module of ['1api', '../evil', 'Api']) {
				await expect(
					createProject(
						defaults({ path: dir, template: 'multi', modules: [module], force: true }),
						exec
					)
				).rejects.toThrow(`Invalid module name "${module}"`);
			}
			expect(existsSync(join(dir, 'my-app', 'src', 'evil'))).toBe(false);
			expect(existsSync(join(dir, 'my-app', 'src', 'modules', '1api'))).toBe(false);
		});

		it('accepts a scoped name and creates the unscoped directory', async () => {
			const path = await createProject(defaults({ name: '@acme/api', path: dir }), exec);

			expect(path).toBe(join(dir, 'api'));
			const pkg = await Bun.file(join(path, 'package.json')).json();
			expect(pkg.name).toBe('@acme/api');
		});
	});
});

describe('embedded assets', () => {
	afterEach(() => useEmbeddedAssets(undefined));

	it('reads and lists the files of a Hephaestus asset loader', async () => {
		const files: Record<string, string> = {
			'stubs/job.stub': 'job',
			'templates/feature-x/.specs': '{}',
			'templates/feature-x/a/b.ts': 'b'
		};
		useEmbeddedAssets({
			getAssetString: (path) => files[path] ?? null,
			listAssets: () => Object.keys(files)
		});

		expect(await readAsset('stubs/job.stub')).toBe('job');
		expect(await listAssets('templates/feature-x')).toEqual(['.specs', 'a/b.ts']);
		await expect(readAsset('stubs/none.stub')).rejects.toThrow('no file');
	});

	it('reads the package files otherwise', async () => {
		expect(await listAssets('templates/feature-prettier')).toContain('.prettierrc');
		expect(await readAsset('stubs/job.stub')).toContain('Job');
	});
});
