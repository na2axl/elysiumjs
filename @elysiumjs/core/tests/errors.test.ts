// Copyright (c) 2025-present Workbud Technologies Inc. All rights reserved.
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

import {
	ConflictingModuleConfigError,
	DuplicateCommandError,
	DuplicateGlobalServiceError,
	ElysiumError,
	EnvironmentSkippedModuleError,
	InvalidModuleError,
	MissingModuleConfigError,
	ModuleCycleError,
	ServiceNotFoundError,
	ServiceNotReadyError,
	ServiceNotVisibleError
} from '../src/errors';

describe('errors', () => {
	it('ModuleCycleError joins the path', () => {
		const e = new ModuleCycleError(['A', 'B', 'A']);
		expect(e).toBeInstanceOf(ElysiumError);
		expect(e.name).toBe('ModuleCycleError');
		expect(e.path).toEqual(['A', 'B', 'A']);
		expect(e.message).toContain('A -> B -> A');
	});

	it('InvalidModuleError names the class', () => {
		const e = new InvalidModuleError('Foo');
		expect(e).toBeInstanceOf(ElysiumError);
		expect(e.name).toBe('InvalidModuleError');
		expect(e.className).toBe('Foo');
		expect(e.message).toContain('Foo');
	});

	it('DuplicateGlobalServiceError names service and modules', () => {
		const e = new DuplicateGlobalServiceError('Svc', ['ModA', 'ModB']);
		expect(e).toBeInstanceOf(ElysiumError);
		expect(e.name).toBe('DuplicateGlobalServiceError');
		expect(e.serviceName).toBe('Svc');
		expect(e.modules).toEqual(['ModA', 'ModB']);
		for (const s of ['Svc', 'ModA', 'ModB']) expect(e.message).toContain(s);
	});

	it('DuplicateCommandError names command and modules', () => {
		const e = new DuplicateCommandError('db:seed', ['ModA', 'ModB']);
		expect(e).toBeInstanceOf(ElysiumError);
		expect(e.name).toBe('DuplicateCommandError');
		expect(e.command).toBe('db:seed');
		expect(e.modules).toEqual(['ModA', 'ModB']);
		for (const s of ['db:seed', 'ModA', 'ModB']) expect(e.message).toContain(s);
	});

	it('ConflictingModuleConfigError names module and sites', () => {
		const e = new ConflictingModuleConfigError('Mod', ['SiteA', 'SiteB']);
		expect(e).toBeInstanceOf(ElysiumError);
		expect(e.name).toBe('ConflictingModuleConfigError');
		expect(e.module).toBe('Mod');
		expect(e.sites).toEqual(['SiteA', 'SiteB']);
		for (const s of ['Mod', 'SiteA', 'SiteB']) expect(e.message).toContain(s);
	});

	it('MissingModuleConfigError names module and keys', () => {
		const e = new MissingModuleConfigError('Mod', ['url', 'token']);
		expect(e).toBeInstanceOf(ElysiumError);
		expect(e.name).toBe('MissingModuleConfigError');
		expect(e.module).toBe('Mod');
		expect(e.keys).toEqual(['url', 'token']);
		for (const s of ['Mod', 'url', 'token']) expect(e.message).toContain(s);
	});

	it('ServiceNotVisibleError hints at the owner', () => {
		const e = new ServiceNotVisibleError('Svc', 'Req', 'ModA', 'ModB');
		expect(e).toBeInstanceOf(ElysiumError);
		expect(e.name).toBe('ServiceNotVisibleError');
		expect(e.service).toBe('Svc');
		expect(e.requester).toBe('Req');
		expect(e.module).toBe('ModA');
		expect(e.owner).toBe('ModB');
		for (const s of ['Svc', 'Req', 'ModA', 'import ModB', "add it to ModB's exports"]) {
			expect(e.message).toContain(s);
		}
	});

	it('ServiceNotVisibleError works without module and owner', () => {
		const e = new ServiceNotVisibleError('Svc', 'Req', null, null);
		expect(e.message).toContain('Svc');
		expect(e.message).toContain('Req');
		expect(e.message).not.toContain('import');
	});

	it('ServiceNotFoundError names the service', () => {
		const e = new ServiceNotFoundError('Svc');
		expect(e).toBeInstanceOf(ElysiumError);
		expect(e.name).toBe('ServiceNotFoundError');
		expect(e.service).toBe('Svc');
		expect(e.message).toContain('Svc');
	});

	it('ServiceNotReadyError mentions Service.resolve', () => {
		const e = new ServiceNotReadyError('Svc');
		expect(e).toBeInstanceOf(ElysiumError);
		expect(e.name).toBe('ServiceNotReadyError');
		expect(e.service).toBe('Svc');
		expect(e.message).toContain('Svc');
		expect(e.message).toContain('Service.resolve');
	});

	it('EnvironmentSkippedModuleError names all arguments', () => {
		const e = new EnvironmentSkippedModuleError('Svc', 'Req', 'SkipMod', 'production');
		expect(e).toBeInstanceOf(ElysiumError);
		expect(e.name).toBe('EnvironmentSkippedModuleError');
		expect(e.service).toBe('Svc');
		expect(e.requester).toBe('Req');
		expect(e.skippedModule).toBe('SkipMod');
		expect(e.environment).toBe('production');
		for (const s of ['Svc', 'Req', 'SkipMod', 'production']) expect(e.message).toContain(s);
	});
});
