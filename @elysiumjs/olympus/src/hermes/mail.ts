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

import type { MailAddress, MailMessage } from './messages';
import type { Notifiable } from './notifiable';

import { getLogger } from '../logger';
import { Port } from '../port';
import { Service } from '../service';
import { HERMES_MAIL_TRANSPORT } from './config';
import {
	HermesAssertionError,
	HermesServiceMissingError,
	MailViewUnsupportedError
} from './errors';

/**
 * A mail ready to send: its addresses, subject and bodies.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type MailEnvelope = {
	readonly to: readonly MailAddress[];
	readonly from?: MailAddress;
	readonly replyTo?: MailAddress;
	readonly cc?: readonly MailAddress[];
	readonly bcc?: readonly MailAddress[];
	readonly subject: string;
	/** The plain text body. */
	readonly text: string;
	/** The HTML body. */
	readonly html?: string;
	readonly headers?: Readonly<Record<string, string>>;
};

/**
 * What a transport answers once a mail is accepted.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type MailReceipt = {
	/** The id the provider gives the mail, when it gives one. */
	readonly messageId?: string;
};

/**
 * Sends mails through a provider. `log` is built in; a provider package or the app adds others.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export interface MailTransportDriver {
	/**
	 * Sends a mail.
	 * @throws {ChannelRejected} When the provider refuses it for good, such as an invalid address.
	 */
	send(mail: MailEnvelope): Promise<MailReceipt>;
}

/**
 * The bodies of a mail.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type RenderedMail = { readonly text: string; readonly html?: string };

/**
 * What a renderer is given with a message.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type MailRenderContext = {
	/** The locale of the notifiable, when it has one. */
	readonly locale?: string;
	/** The notifiable the mail goes to. */
	readonly notifiable?: Notifiable;
	/** The type of the notification. */
	readonly type?: string;
};

/**
 * Draws the bodies of a `MailMessage`. `basic` is built in and lays out the greeting, lines,
 * buttons and salutation; the app plugs its own to draw views with its templates.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export interface MailRendererDriver {
	render(message: MailMessage, context: MailRenderContext): RenderedMail | Promise<RenderedMail>;
}

declare module '../port' {
	interface Ports {
		'mail-transport': MailTransportDriver;
		'mail-renderer': MailRendererDriver;
	}

	interface PortDrivers {
		'mail-transport:log': typeof LogMailTransport;
		'mail-renderer:basic': typeof BasicMailRenderer;
	}
}

/**
 * The mail transport port. `log` is built in, and is the default of `HermesModule`.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @example
 * ```ts
 * HermesModule.with({ mail: { transport: () => MailTransport.for('log') } });
 * ```
 */
export class MailTransport extends Port('mail-transport') {}

/**
 * The mail renderer port. `basic` is built in, and is the default of `HermesModule`.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class MailRenderer extends Port('mail-renderer') {}

/** The address of a {@link MailAddress}. */
const addressOf = (address: MailAddress): string =>
	typeof address === 'string' ? address : address.address;

/**
 * Writes mails to the application log instead of sending them, for development.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
@MailTransport.driver('log')
export class LogMailTransport implements MailTransportDriver {
	public async send(mail: MailEnvelope): Promise<MailReceipt> {
		getLogger().info('Mail', {
			to: mail.to.map(addressOf),
			subject: mail.subject,
			text: mail.text
		});
		return {};
	}
}

const escapeHtml = (text: string): string =>
	text
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');

/**
 * Lays out a `MailMessage` as plain text and simple HTML: the greeting, the lines and buttons in
 * order, and the salutation. It does not draw views: a message with a view needs the renderer of
 * the app.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
@MailRenderer.driver('basic')
export class BasicMailRenderer implements MailRendererDriver {
	public render(message: MailMessage): RenderedMail {
		const content = message.toJSON();
		if (content.view) throw new MailViewUnsupportedError(content.view.name);
		const text: string[] = [];
		const html: string[] = [];
		if (content.greeting) {
			text.push(content.greeting);
			html.push(`<h1>${escapeHtml(content.greeting)}</h1>`);
		}
		for (const part of content.parts) {
			if (part.kind === 'line') {
				text.push(part.text);
				html.push(`<p>${escapeHtml(part.text)}</p>`);
			} else {
				text.push(`${part.text}: ${part.url}`);
				html.push(`<p><a href="${escapeHtml(part.url)}">${escapeHtml(part.text)}</a></p>`);
			}
		}
		if (content.salutation) {
			text.push(content.salutation);
			html.push(`<p>${escapeHtml(content.salutation)}</p>`);
		}
		return { text: text.join('\n\n'), html: html.join('\n') };
	}
}

/**
 * Records the mails sent while `Mail.fake()` is on, with assertions for tests.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class MailFake {
	/** The mails sent, in order. */
	public readonly sent: MailEnvelope[] = [];

	/** The mails sent to an address, or that match a check. */
	public sentTo(match: string | ((mail: MailEnvelope) => boolean)): MailEnvelope[] {
		const check =
			typeof match === 'string'
				? (mail: MailEnvelope) => mail.to.some((to) => addressOf(to) === match)
				: match;
		return this.sent.filter(check);
	}

	/**
	 * Throws unless a mail went to the address, or matches the check.
	 * @throws {HermesAssertionError}
	 */
	public assertSent(match: string | ((mail: MailEnvelope) => boolean)): void {
		if (this.sentTo(match).length === 0) {
			throw new HermesAssertionError(
				typeof match === 'string' ? `No mail was sent to ${match}.` : 'No mail matches.'
			);
		}
	}

	/**
	 * Throws if any mail was sent.
	 * @throws {HermesAssertionError}
	 */
	public assertNothingSent(): void {
		if (this.sent.length > 0) {
			throw new HermesAssertionError(`${this.sent.length} mail(s) were sent.`);
		}
	}

	/** Sends mails through the transport again. */
	public restore(): void {
		if (mailFake === this) mailFake = null;
	}
}

let mailFake: MailFake | null = null;

/**
 * Sends mails through the transport of `HermesModule`, outside notifications too.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @example
 * ```ts
 * await Mail.send({ to: ['ada@example.com'], subject: 'Hello', text: 'Hello Ada' });
 *
 * const mails = Mail.fake();
 * // ...
 * mails.assertSent('ada@example.com');
 * mails.restore();
 * ```
 */
export namespace Mail {
	/**
	 * Sends a mail, or records it while `Mail.fake()` is on.
	 * @throws {HermesServiceMissingError} When no module provides the mail transport.
	 */
	export const send = async (mail: MailEnvelope): Promise<MailReceipt> => {
		if (mailFake) {
			mailFake.sent.push(mail);
			return {};
		}
		const transport = Service.get<MailTransportDriver>(HERMES_MAIL_TRANSPORT);
		if (!transport) throw new HermesServiceMissingError('mail transport');
		return transport.send(mail);
	};

	/** Records mails instead of sending them, until `restore()`. */
	export const fake = (): MailFake => {
		mailFake = new MailFake();
		return mailFake;
	};
}
