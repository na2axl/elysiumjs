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

import type { Scenario } from './types';

import {
	Application,
	DATABASE_TRANSACTION_SERVICE,
	Http,
	Module,
	Service,
	t
} from '@elysiumjs/core';
import { withUnitOfWork } from '@elysiumjs/mnemosyne';
import {
	Action,
	MemoryIdempotencyStore,
	MemoryOutboxStore,
	Moirai,
	MoiraiModule,
	Outbox
} from '@elysiumjs/moirai';

const make = async (): Promise<Application> => {
	const wallet = { balance: 0, mails: [] as string[] };

	@Service.register({ name: 'conformance.mailer' })
	class Mailer {
		@Outbox.handle('conformance.wallet.credited')
		public send(payload: { balance: number }) {
			wallet.mails.push(`credited:${payload.balance}`);
		}
	}

	@Action.register({
		name: 'top-up',
		input: t.Object({ amount: t.Integer({ minimum: 1 }) }),
		idempotent: true
	})
	class TopUp extends Action<{ amount: number }> {
		public async handle(input: { amount: number }) {
			wallet.balance += input.amount;
			await Outbox.enqueue({
				kind: 'conformance.wallet.credited',
				payload: { balance: wallet.balance }
			});
			return { balance: wallet.balance };
		}
	}

	@Http.controller({ path: '/wallet' })
	class WalletController {
		@Http.post({ path: '/top-up' })
		public topUp(@Http.context() c: { body: unknown; request: Request }) {
			return Moirai.execute(TopUp, c.body as { amount: number }, {
				idempotencyKey: c.request.headers.get('idempotency-key') ?? undefined
			});
		}

		@Http.get({ path: '/' })
		public show() {
			return wallet;
		}
	}

	@Module.register({
		controllers: [WalletController],
		services: [
			Mailer,
			{
				name: DATABASE_TRANSACTION_SERVICE,
				global: true,
				// A unit of work without a database: the hooks run once the callback resolves.
				factory: () => withUnitOfWork((callback) => callback())
			}
		]
	})
	class WalletModule extends Module {}

	@Application.register({
		modules: [
			MoiraiModule.with({
				idempotency: () => new MemoryIdempotencyStore(),
				outbox: () => new MemoryOutboxStore()
			}),
			WalletModule
		],
		openapi: false
	})
	class WalletApp extends Application {}

	return new WalletApp();
};

const topUp = (key: string | null, amount: number) => () =>
	new Request('http://localhost/wallet/top-up', {
		method: 'POST',
		headers: { 'content-type': 'application/json', ...(key ? { 'idempotency-key': key } : {}) },
		body: JSON.stringify({ amount })
	});

/**
 * An idempotent action replays its response for a repeated key, refuses a missing key (428) and
 * a reused key with another input (422), and its outbox effect relays once it commits.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export const actions: Scenario = {
	name: 'actions: idempotent replay and outbox relay after commit',
	app: make,
	requests: [
		{ request: topUp('k1', 10), expect: { status: 200, json: { balance: 10 } } },
		{ request: topUp('k1', 10), expect: { status: 200, json: { balance: 10 } } },
		{ request: topUp('k1', 99), expect: { status: 422 } },
		{ request: topUp(null, 10), expect: { status: 428 } },
		{
			request: () => new Request('http://localhost/wallet'),
			expect: { status: 200, json: { balance: 10, mails: ['credited:10'] } }
		}
	]
};
