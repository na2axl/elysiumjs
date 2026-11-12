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

import type { ModuleNode } from '../src/module-graph';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { Container } from '../src/container';
import { Environments } from '../src/environments';
import { DuplicateExtensionError, NotAnExtensionError } from '../src/errors';
import { ModuleContext } from '../src/module-context';
import { Service, ServiceScope } from '../src/service';
import { resetContainer } from '../src/testing';

interface Transport {
	send(): string;
}

type TransportOptions = { name: string; channel: 'email' | 'sms'; devOnly?: boolean };

const A: ModuleNode = { id: 'A' } as ModuleNode;
const B: ModuleNode = { id: 'B' } as ModuleNode;

describe('Service.extension', () => {
	beforeEach(() => {
		resetContainer();
		Container.setVisibility({ visibleOwners: () => [], exportsOf: () => [], nodes: [A, B] });
	});

	afterEach(() => resetContainer());

	it('registers tagged services with their options', () => {
		const Transports = Service.extension<Transport, TransportOptions>('test.transports');

		@Transports.register({ name: 'resend', channel: 'email' })
		class ResendTransport implements Transport {
			public send() {
				return 'resend';
			}
		}

		@Transports.register({ name: 'twilio', channel: 'sms' })
		class TwilioTransport implements Transport {
			public send() {
				return 'twilio';
			}
		}

		Container.register(A, ResendTransport, undefined);
		Container.register(B, TwilioTransport, undefined);

		ModuleContext.run(A, () => {
			expect(
				Transports.all().map(({ service, options }) => [service.send(), options.channel])
			).toEqual([
				['resend', 'email'],
				['twilio', 'sms']
			]);
			expect(Transports.find('twilio')?.send()).toBe('twilio');
			expect(Transports.find('none')).toBeUndefined();
			expect(Service.getAll(Transports.tag)).toHaveLength(2);
		});
		expect(Transports.optionsOf(ResendTransport)).toEqual({ name: 'resend', channel: 'email' });
	});

	it('derives the environments and the scope of the services', () => {
		const Transports = Service.extension<Transport, TransportOptions>('test.env-transports', {
			env: (options) => (options.devOnly ? Environments.local : undefined),
			scope: ServiceScope.FACTORY
		});

		@Transports.register({ name: 'log', channel: 'email', devOnly: true })
		class LogTransport implements Transport {
			public send() {
				return 'log';
			}
		}

		@Transports.register({ name: 'resend', channel: 'email' })
		class ResendTransport implements Transport {
			public send() {
				return 'resend';
			}
		}

		expect(Environments.of(LogTransport)).toEqual(['development', 'test']);
		expect(Environments.of(ResendTransport)).toBeUndefined();
		Container.register(A, LogTransport, undefined);
		ModuleContext.run(A, () => {
			expect(Service.get(LogTransport)).not.toBe(Service.get(LogTransport));
		});
	});

	it('refuses two services with the same name', () => {
		const Transports = Service.extension<Transport, TransportOptions>('test.dup-transports');

		@Transports.register({ name: 'mail', channel: 'email' })
		class FirstMail implements Transport {
			public send() {
				return 'first';
			}
		}

		@Transports.register({ name: 'mail', channel: 'email' })
		class SecondMail implements Transport {
			public send() {
				return 'second';
			}
		}

		Container.register(A, FirstMail, undefined);
		Container.register(B, SecondMail, undefined);

		ModuleContext.run(A, () => {
			expect(() => Transports.all()).toThrow(DuplicateExtensionError);
			expect(() => Transports.all()).toThrow(
				'Two services of test.dup-transports are named "mail": FirstMail and SecondMail.'
			);
		});
	});

	it('says when a class is not one of its services', () => {
		const Transports = Service.extension<Transport, TransportOptions>('test.other-transports');
		class Plain {}
		expect(() => Transports.optionsOf(Plain)).toThrow(NotAnExtensionError);
		expect(() => Transports.optionsOf(new Plain())).toThrow(
			'Plain is not registered as a service of test.other-transports.'
		);
	});
});

describe('classes with the same name', () => {
	beforeEach(() => {
		resetContainer();
		Container.setVisibility({ visibleOwners: () => [], exportsOf: () => [], nodes: [A, B] });
	});

	afterEach(() => resetContainer());

	it('are distinct services in two modules, since the class is the token', () => {
		const make = (label: string) => {
			@Service.register()
			class ProfileClosedListener {
				public readonly label = label;
			}
			return ProfileClosedListener;
		};
		const InA = make('a');
		const InB = make('b');
		expect(InA.name).toBe(InB.name);

		Container.register(A, InA, undefined);
		Container.register(B, InB, undefined);

		expect(ModuleContext.run(A, () => Service.get(InA))?.label).toBe('a');
		expect(ModuleContext.run(B, () => Service.get(InB))?.label).toBe('b');
	});
});
