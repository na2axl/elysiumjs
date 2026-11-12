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

import type {
	ChannelContext,
	MailEnvelope,
	Notifiable,
	NotificationChannel,
	NotificationEvent
} from '../../src/hermes/index';
import type { TestingApp } from '../../src/index';

import { afterEach, describe, expect, it, spyOn } from 'bun:test';

import { Heracles, HeraclesModule, MemoryTransport } from '../../src/heracles/index';
import {
	BasicMailRenderer,
	BroadcastMessage,
	ChannelRejected,
	HERMES_BROADCAST,
	HERMES_FAILED,
	HERMES_SENDING,
	HERMES_SENT,
	HermesAssertionError,
	HermesModule,
	InboxMessage,
	InvalidChannelMessageError,
	LogMessage,
	Mail,
	MailMessage,
	MailViewUnsupportedError,
	MemoryNotificationStore,
	MissingChannelMessageError,
	Notification,
	QueuedNotificationDataError,
	QueuedNotificationsUnavailableError,
	UnknownChannelError,
	UnregisteredNotificationError
} from '../../src/hermes/index';
import { Application, DATABASE_TRANSACTION_SERVICE } from '../../src/index';
import { LifecycleBus } from '../../src/lifecycle';
import { UnitOfWork, withUnitOfWork } from '../../src/mnemosyne/index';

class SmsMessage {
	constructor(public readonly text: string) {}
}

declare module '../../src/hermes/channel' {
	interface NotificationChannels {
		sms: SmsMessage;
		push: SmsMessage;
	}
}

const sms: { to: unknown; text: string }[] = [];
let smsRejects = false;

@Notification.channel('sms', { message: SmsMessage })
class SmsChannel implements NotificationChannel<SmsMessage> {
	public send(notifiable: Notifiable, message: SmsMessage) {
		if (smsRejects) throw new ChannelRejected('unknown number');
		sms.push({ to: notifiable.routeNotificationFor('sms'), text: message.text });
		return { ref: 'sms-1' };
	}
}

@Notification.channel('push', { message: SmsMessage })
class PushChannel implements NotificationChannel<SmsMessage> {
	public isAvailable() {
		return false;
	}

	public send() {
		throw new Error('never');
	}
}

class User implements Notifiable {
	public readonly notifiableType = 'user';

	constructor(
		public readonly notifiableId: string,
		public email: string | null = `${notifiableId}@example.com`,
		public phone: string | null = '+15550100',
		public muted: string[] = []
	) {}

	public routeNotificationFor(channel: string) {
		return channel === 'mail' ? this.email : channel === 'sms' ? this.phone : null;
	}

	public preferredLocale() {
		return 'fr';
	}
}

const users = new Map<string, User>();

@Notification.resolver('user')
class UserResolver {
	public resolve(id: string) {
		return users.get(id) ?? null;
	}
}

type PaidData = { invoiceId: string; at?: Date };

@Notification.register({ type: 'invoice.paid' })
class InvoicePaid extends Notification<PaidData> {
	public channels() {
		return ['inbox', ['mail', 'sms']] as const;
	}

	public canSend(notifiable: Notifiable, channel: string) {
		return !(notifiable as User).muted?.includes(channel);
	}

	public inbox() {
		return new InboxMessage({ invoiceId: this.data.invoiceId });
	}

	public mail() {
		return new MailMessage()
			.subject('Paid')
			.greeting('Hello')
			.line(`Invoice ${this.data.invoiceId}`)
			.action('Open', 'https://example.com/i?a=1&b=2');
	}

	public sms(notifiable: Notifiable) {
		return new SmsMessage(`paid ${this.data.invoiceId} ${notifiable.preferredLocale?.()}`);
	}
}

@Notification.register({ type: 'invoice.queued', queue: 'notifications' })
class InvoiceQueued extends InvoicePaid {
	public sms(notifiable: Notifiable) {
		const at = this.data.at instanceof Date ? this.data.at.toISOString() : 'none';
		return new SmsMessage(
			`queued ${this.data.invoiceId} ${at} ${notifiable.routeNotificationFor('sms')}`
		);
	}
}

@Notification.register({ type: 'invoice.later', queue: 'notifications', delay: { sms: 60_000 } })
class InvoiceLater extends InvoiceQueued {
	public channels() {
		return ['sms'] as const;
	}
}

@Notification.register({ type: 'ping' })
class Ping extends Notification {
	public channels() {
		return ['log', 'broadcast'] as const;
	}

	public log() {
		return new LogMessage('ping').level('warn');
	}

	public broadcast() {
		return new BroadcastMessage({ n: 1 }).as('pinged');
	}
}

@Notification.register({ type: 'broken.missing' })
class MissingMethod extends Notification {
	public channels() {
		return ['sms'] as const;
	}
}

@Notification.register({ type: 'broken.wrong' })
class WrongMessage extends Notification {
	public channels() {
		return ['sms'] as const;
	}

	public sms() {
		return new LogMessage('not an sms') as unknown as SmsMessage;
	}
}

@Notification.register({ type: 'broken.unknown' })
class UnknownChannel extends Notification {
	public channels() {
		return ['fax' as 'sms'] as const;
	}
}

class Unregistered extends Notification {
	public channels() {
		return ['log'] as const;
	}
}

@Notification.register({ type: 'pushed' })
class Pushed extends Notification {
	public channels() {
		return [['push', 'sms']] as const;
	}

	public sms() {
		return new SmsMessage('fallback');
	}
}

describe('Notification', () => {
	let app: TestingApp | undefined;
	let store: MemoryNotificationStore;

	const boot = async (options: { heracles?: boolean } = {}) => {
		store = new MemoryNotificationStore();
		app = await Application.testing({
			modules: [
				...(options.heracles === false
					? []
					: [
							HeraclesModule.with({
								queues: { notifications: { transport: MemoryTransport } }
							})
						]),
				HermesModule.with({ store, mail: { from: 'hello@example.com' } })
			] as never[],
			overrides: {
				[DATABASE_TRANSACTION_SERVICE]: withUnitOfWork((callback) => callback())
			}
		});
	};

	const events = () => {
		const seen: [string, NotificationEvent][] = [];
		const on = (name: string) => (event: { data: NotificationEvent }) => {
			seen.push([name, event.data]);
		};
		const handlers = [HERMES_SENDING, HERMES_SENT, HERMES_FAILED].map(
			(name) => [name, on(name)] as const
		);
		for (const [name, handler] of handlers) LifecycleBus.instance.on(name, handler);
		return {
			seen,
			off: () => {
				for (const [name, handler] of handlers) LifecycleBus.instance.off(name, handler);
			}
		};
	};

	afterEach(async () => {
		await app?.shutdown();
		app = undefined;
		sms.length = 0;
		smsRejects = false;
		users.clear();
	});

	it('keeps it in the inbox and mails it, the first channel of the chain that delivers', async () => {
		await boot();
		const mails = Mail.fake();
		try {
			const deliveries = await Notification.sendNow(
				new User('u1'),
				new InvoicePaid({ invoiceId: 'i1' })
			);
			expect(deliveries.map((d) => d.channel)).toEqual(['inbox', 'mail']);
			mails.assertSent('u1@example.com');
			const [mail] = mails.sent as [MailEnvelope];
			expect(mail).toMatchObject({ from: 'hello@example.com', subject: 'Paid' });
			expect(mail.text).toContain('Open: https://example.com/i?a=1&b=2');
			expect(mail.html).toContain('href="https://example.com/i?a=1&amp;b=2"');
			expect(sms).toEqual([]);

			const page = await Notification.store().list('u1');
			expect(page.items).toMatchObject([
				{ notifiableId: 'u1', type: 'invoice.paid', data: { invoiceId: 'i1' }, readAt: null }
			]);
			expect(page.items[0]!.id).toBe(deliveries[0]!.id);
		} finally {
			mails.restore();
		}
	});

	it('falls back when a channel is unavailable, refused by canSend, or rejects', async () => {
		await boot();
		const mails = Mail.fake();
		const seen = events();
		try {
			// No address: the mail channel is unavailable.
			await Notification.sendNow(new User('u1', null), new InvoicePaid({ invoiceId: 'a' }));
			// Muted mail: canSend refuses it.
			await Notification.sendNow(
				new User('u2', 'u2@example.com', '+1', ['mail']),
				new InvoicePaid({ invoiceId: 'b' })
			);
			expect(sms.map((s) => s.text)).toEqual(['paid a fr', 'paid b fr']);
			mails.assertNothingSent();

			// Every channel of the chain rejects or is unavailable: nothing delivers.
			smsRejects = true;
			const [, chain] = await Notification.sendNow(
				new User('u3', null),
				new InvoicePaid({ invoiceId: 'c' })
			);
			expect(chain?.channel).toBeNull();
			const failed = seen.seen.filter(([name]) => name === HERMES_FAILED);
			expect(failed).toHaveLength(1);
			expect(failed[0]![1]).toMatchObject({ channel: 'sms', type: 'invoice.paid' });
			expect(failed[0]![1].error).toBeInstanceOf(ChannelRejected);

			const [pushed] = await Notification.sendNow(new User('u4'), new Pushed());
			expect(pushed?.channel).toBeNull();
			smsRejects = false;
			const [fallback] = await Notification.sendNow(new User('u4'), new Pushed());
			expect(fallback).toMatchObject({ channel: 'sms', result: { ref: 'sms-1' } });
		} finally {
			seen.off();
			mails.restore();
		}
	});

	it('emits sending and sent around each delivery', async () => {
		await boot();
		const seen = events();
		try {
			await Notification.sendNow(new User('u1', null), new InvoicePaid({ invoiceId: 'e' }));
			expect(seen.seen.map(([name, data]) => `${name.split(':').pop()} ${data.channel}`)).toEqual([
				'sending inbox',
				'sent inbox',
				'sending sms',
				'sent sms'
			]);
			expect(seen.seen[3]![1].result).toEqual({ ref: 'sms-1' });
		} finally {
			seen.off();
		}
	});

	it('reaches someone at an address, with no inbox', async () => {
		await boot();
		const mails = Mail.fake();
		try {
			const deliveries = await Notification.route('mail', 'ada@example.com')
				.route('sms', '+15550111')
				.locale('en')
				.notifyNow(new InvoicePaid({ invoiceId: 'r' }));
			expect(deliveries.map((d) => d.channel)).toEqual([null, 'mail']);
			mails.assertSent('ada@example.com');
			expect(await store.list('ada@example.com')).toEqual({ items: [], nextCursor: null });
		} finally {
			mails.restore();
		}
	});

	it('writes to the log and broadcasts', async () => {
		await boot();
		const broadcasts: unknown[] = [];
		const handler = (event: { data: unknown }) => broadcasts.push(event.data);
		LifecycleBus.instance.on(HERMES_BROADCAST, handler);
		try {
			const deliveries = await Notification.sendNow(new User('u1'), new Ping());
			expect(deliveries.map((d) => d.channel)).toEqual(['log', 'broadcast']);
			expect(broadcasts).toEqual([
				{ id: deliveries[1]!.id, type: 'ping', event: 'pinged', notifiableId: 'u1', data: { n: 1 } }
			]);
		} finally {
			LifecycleBus.instance.off(HERMES_BROADCAST, handler);
		}
	});

	it('refuses a missing method, a wrong message, an unknown channel and an unregistered class', async () => {
		await boot();
		const user = new User('u1');
		await expect(Notification.sendNow(user, new MissingMethod())).rejects.toBeInstanceOf(
			MissingChannelMessageError
		);
		await expect(Notification.sendNow(user, new WrongMessage())).rejects.toBeInstanceOf(
			InvalidChannelMessageError
		);
		await expect(Notification.sendNow(user, new UnknownChannel())).rejects.toBeInstanceOf(
			UnknownChannelError
		);
		expect(() => Notification.sendNow(user, new Unregistered())).toThrow(
			UnregisteredNotificationError
		);
	});

	it('waits for the unit of work to commit, and drops it on rollback', async () => {
		await boot();
		const user = new User('u1', null);
		await UnitOfWork.run(async () => {
			await Notification.send(user, new InvoicePaid({ invoiceId: 'commit' }));
			expect(sms).toEqual([]);
		});
		expect(sms.map((s) => s.text)).toEqual(['paid commit fr']);

		await expect(
			UnitOfWork.run(async () => {
				await Notification.send(user, new InvoicePaid({ invoiceId: 'rollback' }));
				throw new Error('rollback');
			})
		).rejects.toThrow('rollback');
		expect(sms).toHaveLength(1);
	});

	it('records notifications while faked', async () => {
		await boot();
		const fake = Notification.fake();
		try {
			const user = new User('u1');
			await Notification.send(user, new InvoicePaid({ invoiceId: 'f' }));
			await Notification.send([new User('u2')], new Ping());
			expect(sms).toEqual([]);
			expect(await store.unreadCount('u1')).toBe(0);
			fake.assertSentTo(
				user,
				InvoicePaid,
				(n, channels) => n.data.invoiceId === 'f' && channels.length === 2
			);
			fake.assertSentTo('u2', Ping);
			fake.assertNotSentTo('u2', InvoicePaid);
			fake.assertSentTimes(InvoicePaid, 1);
			expect(() => fake.assertNothingSent()).toThrow(HermesAssertionError);
			expect(() => fake.assertSentTo('u3', Ping)).toThrow(HermesAssertionError);
		} finally {
			fake.restore();
		}
		await Notification.send(new User('u1', null), new InvoicePaid({ invoiceId: 'real' }));
		expect(sms).toHaveLength(1);
	});

	describe('queued', () => {
		it('runs one job per notifiable and entry, with dates in the data', async () => {
			await boot();
			const dispatch = spyOn(Heracles, 'dispatch');
			try {
				const recipients = [new User('u1', null), new User('u2', null)];
				for (const user of recipients) users.set(user.notifiableId, user);
				await Notification.send(
					recipients,
					new InvoiceQueued({ invoiceId: 'q', at: new Date('2026-01-01T00:00:00Z') })
				);
				expect(dispatch).toHaveBeenCalledTimes(4);
				expect(sms).toEqual([]);
				await MemoryTransport.settled();
				expect(sms.map((s) => s.text)).toEqual([
					'queued q 2026-01-01T00:00:00.000Z +15550100',
					'queued q 2026-01-01T00:00:00.000Z +15550100'
				]);
				expect(await store.unreadCount('u1')).toBe(1);
			} finally {
				dispatch.mockRestore();
			}
		});

		it('reads the notifiable again through its resolver', async () => {
			await boot();
			const user = new User('u1', null, '+1000');
			users.set('u1', user);
			await Notification.send(user, new InvoiceQueued({ invoiceId: 'r' }));
			user.phone = '+2000';
			await MemoryTransport.settled();
			expect(sms.map((s) => s.to)).toEqual(['+2000']);
		});

		it('keeps the routes it had when queued without a resolver, and drops a gone notifiable', async () => {
			await boot();
			const snapshot = new User('u1', null, '+1000');
			Object.defineProperty(snapshot, 'notifiableType', { value: 'guest' });
			await Notification.send(snapshot, new InvoiceQueued({ invoiceId: 's' }));
			snapshot.phone = '+2000';
			await Notification.send(new User('gone', null), new InvoiceQueued({ invoiceId: 'g' }));
			await MemoryTransport.settled();
			expect(sms.map((s) => s.to)).toEqual(['+1000']);
		});

		it('delays the entry by its first channel', async () => {
			await boot();
			const dispatch = spyOn(Heracles, 'dispatch');
			try {
				await Notification.send(new User('u1'), new InvoiceLater({ invoiceId: 'l' }));
				const options = dispatch.mock.calls[0]?.[2];
				expect(options?.queue).toBe('notifications');
				expect(options?.scheduledFor?.getTime()).toBeGreaterThan(Date.now() + 50_000);
			} finally {
				dispatch.mockRestore();
			}
		});

		it('refuses data that does not survive JSON', async () => {
			await boot();
			await expect(
				Notification.send(new User('u1'), new InvoiceQueued({ invoiceId: new Map() as never }))
			).rejects.toBeInstanceOf(QueuedNotificationDataError);
		});

		it('needs HeraclesModule', async () => {
			await boot({ heracles: false });
			await expect(
				Notification.send(new User('u1'), new InvoiceQueued({ invoiceId: 'x' }))
			).rejects.toBeInstanceOf(QueuedNotificationsUnavailableError);
		});

		it('sendNow delivers it right away', async () => {
			await boot();
			await Notification.sendNow(new User('u1', null), new InvoiceQueued({ invoiceId: 'now' }));
			expect(sms.map((s) => s.text)).toEqual(['queued now none +15550100']);
		});
	});
});

describe('MemoryNotificationStore', () => {
	const row = (id: string, notifiableId = 'u1') => ({
		id,
		notifiableId,
		type: 't',
		data: {},
		readAt: null,
		createdAt: new Date()
	});

	it('pages newest first, counts, marks as read and deletes', async () => {
		const store = new MemoryNotificationStore();
		for (const id of ['a', 'b', 'c']) await store.save(row(id));
		await store.save(row('z', 'u2'));
		await store.save({ ...row('a'), type: 'again' });

		const first = await store.list('u1', { limit: 2 });
		expect(first.items.map((r) => r.id)).toEqual(['c', 'b']);
		const second = await store.list('u1', { limit: 2, cursor: first.nextCursor! });
		expect(second).toMatchObject({ items: [{ id: 'a', type: 't' }], nextCursor: null });

		expect(await store.markAsRead('u1', ['b', 'z'])).toBe(1);
		expect(await store.unreadCount('u1')).toBe(2);
		expect((await store.list('u1', { unread: true })).items.map((r) => r.id)).toEqual(['c', 'a']);
		expect(await store.markAllAsRead('u1')).toBe(2);
		expect(await store.unreadCount('u1')).toBe(0);
		expect(await store.delete('u1', ['a', 'z'])).toBe(1);
		expect(await store.unreadCount('u2')).toBe(1);
	});
});

describe('BasicMailRenderer', () => {
	it('escapes HTML and refuses views', () => {
		const renderer = new BasicMailRenderer();
		const { html } = renderer.render(new MailMessage().line('<b>x</b>').salutation('Bye'));
		expect(html).toBe('<p>&lt;b&gt;x&lt;/b&gt;</p>\n<p>Bye</p>');
		expect(() => renderer.render(new MailMessage().view('welcome'))).toThrow(
			MailViewUnsupportedError
		);
	});
});

export const unused = [SmsChannel, PushChannel, UserResolver, {} as ChannelContext];
