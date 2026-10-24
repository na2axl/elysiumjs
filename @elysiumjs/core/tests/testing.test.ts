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

import { afterEach, describe, expect, it } from 'bun:test';

import { Container } from '../src/container';
import { ServiceNotVisibleError } from '../src/errors';
import { Module } from '../src/module';
import { Service } from '../src/service';
import { createTestingApp } from '../src/testing';

const events: string[] = [];

class Mailer {
	public send() {
		return 'real';
	}
	public onDestroy() {
		events.push('destroy:Mailer');
	}
}

@Module.register({ services: [Mailer], exports: [Mailer] })
class MailModule extends Module {
	public async onInit() {
		events.push('init:MailModule');
	}
	public async onDestroy() {
		events.push('destroy:MailModule');
	}
}

// `Application.testing` delegates to createTestingApp (checked in app.test.ts); tests/middleware.test.ts
// replaces the app module for the rest of the run, so the helper is imported directly here.
describe('Application.testing', () => {
	let app: Awaited<ReturnType<typeof createTestingApp>> | undefined;

	afterEach(async () => {
		await app?.shutdown();
		app = undefined;
		events.length = 0;
	});

	it('lets an override replace a module service', async () => {
		app = await createTestingApp({
			modules: [MailModule],
			overrides: { Mailer: { send: () => 'fake' } }
		});
		const mailer = await app.get<Mailer>(Mailer, MailModule);
		expect(mailer.send()).toBe('fake');
		expect((await app.get<Mailer>('Mailer')).send()).toBe('fake');
	});

	it('lets an override win over a global module service', async () => {
		@Service.register({ global: true })
		class Clock {
			public now() {
				return 'real';
			}
		}
		@Module.register({ services: [Clock] })
		class ClockModule extends Module {}

		app = await createTestingApp({
			modules: [ClockModule],
			overrides: { Clock: { now: () => 'fake' } }
		});
		expect((await app.get<Clock>(Clock)).now()).toBe('fake');
	});

	it('loads env: test modules by default and skips them in production', async () => {
		class Probe {}
		@Module.register({ env: ['test'], services: [Probe], exports: [Probe] })
		class TestOnlyModule extends Module {}

		app = await createTestingApp({ modules: [TestOnlyModule] });
		expect(app.kernel.graph.node(TestOnlyModule)).toBeDefined();
		await app.shutdown();

		app = await createTestingApp({ modules: [TestOnlyModule], environment: 'production' });
		expect(app.kernel.graph.node(TestOnlyModule)).toBeUndefined();
	});

	it('respects visibility when resolving from a module', async () => {
		class Secret {}
		@Module.register({ services: [Secret] })
		class VaultModule extends Module {}
		@Module.register({})
		class OtherModule extends Module {}

		app = await createTestingApp({ modules: [VaultModule, OtherModule] });
		expect(await app.get(Secret, VaultModule)).toBeInstanceOf(Secret);
		await expect(app.get(Secret, OtherModule)).rejects.toBeInstanceOf(ServiceNotVisibleError);
	});

	it('calls onDestroy on shutdown and resets the container', async () => {
		app = await createTestingApp({ modules: [MailModule], boot: 'eager' });
		expect(events).toContain('init:MailModule');

		await app.shutdown();
		expect(events).toEqual(['init:MailModule', 'destroy:Mailer', 'destroy:MailModule']);
		expect(Container.constructed()).toHaveLength(0);
	});

	it('starts from a clean container on every call', async () => {
		app = await createTestingApp({ modules: [MailModule] });
		const second = await createTestingApp({ modules: [] });
		expect(Container.hasGlobal('Mailer')).toBe(false);
		await second.shutdown();
	});
});
