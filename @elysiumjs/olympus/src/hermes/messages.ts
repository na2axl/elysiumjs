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

/**
 * A mail address: the address alone, or with the name shown next to it.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type MailAddress = string | { readonly address: string; readonly name?: string };

/**
 * What the `inbox` channel keeps: the data the inbox of the app shows, stored as JSON.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @example
 * ```ts
 * public inbox() {
 * 	return new InboxMessage({ title: 'Invoice paid', invoiceId: this.data.invoiceId });
 * }
 * ```
 */
export class InboxMessage {
	/**
	 * @param data The data to keep, JSON-safe.
	 */
	constructor(public readonly data: Record<string, unknown>) {}
}

/**
 * A part of the body of a {@link MailMessage}: a line of text, or a button.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type MailPart =
	| { readonly kind: 'line'; readonly text: string }
	| { readonly kind: 'action'; readonly text: string; readonly url: string };

/**
 * What the `mail` channel sends, built step by step: a subject, a greeting, lines and buttons, and
 * a salutation, which the mail renderer lays out; or a view of the app with its data, which the
 * renderer of the app draws.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @example
 * ```ts
 * public mail() {
 * 	return new MailMessage()
 * 		.subject('Your invoice is paid')
 * 		.greeting('Hello!')
 * 		.line('We received your payment.')
 * 		.action('See the invoice', `https://example.com/invoices/${this.data.invoiceId}`);
 * }
 * ```
 */
export class MailMessage {
	#subject?: string;
	#greeting?: string;
	#salutation?: string;
	#level: 'info' | 'success' | 'error' = 'info';
	#view?: { readonly name: string; readonly data: Record<string, unknown> };
	#from?: MailAddress;
	#replyTo?: MailAddress;
	readonly #cc: MailAddress[] = [];
	readonly #bcc: MailAddress[] = [];
	readonly #parts: MailPart[] = [];
	readonly #headers: Record<string, string> = {};

	/** Sets the subject. */
	public subject(subject: string): this {
		this.#subject = subject;
		return this;
	}

	/** Sets the greeting, the first line of the body. */
	public greeting(greeting: string): this {
		this.#greeting = greeting;
		return this;
	}

	/** Adds a line of text. */
	public line(text: string): this {
		this.#parts.push({ kind: 'line', text });
		return this;
	}

	/** Adds a button that opens a link. */
	public action(text: string, url: string): this {
		this.#parts.push({ kind: 'action', text, url });
		return this;
	}

	/** Sets the salutation, the last line of the body. */
	public salutation(salutation: string): this {
		this.#salutation = salutation;
		return this;
	}

	/** Sets the tone of the message, which a renderer may show: `info` by default. */
	public level(level: 'info' | 'success' | 'error'): this {
		this.#level = level;
		return this;
	}

	/** Draws the message with a view of the app, given to the mail renderer with its data. */
	public view(name: string, data: Record<string, unknown> = {}): this {
		this.#view = { name, data };
		return this;
	}

	/** Sets the sender, instead of the `from` of `HermesModule`. */
	public from(from: MailAddress): this {
		this.#from = from;
		return this;
	}

	/** Sets the address replies go to. */
	public replyTo(replyTo: MailAddress): this {
		this.#replyTo = replyTo;
		return this;
	}

	/** Adds addresses in copy. */
	public cc(...addresses: MailAddress[]): this {
		this.#cc.push(...addresses);
		return this;
	}

	/** Adds addresses in blind copy. */
	public bcc(...addresses: MailAddress[]): this {
		this.#bcc.push(...addresses);
		return this;
	}

	/** Adds a header. */
	public header(name: string, value: string): this {
		this.#headers[name] = value;
		return this;
	}

	/** What the message holds, for renderers and transports. */
	public toJSON(): MailMessageContent {
		return {
			subject: this.#subject,
			greeting: this.#greeting,
			parts: [...this.#parts],
			salutation: this.#salutation,
			level: this.#level,
			view: this.#view,
			from: this.#from,
			replyTo: this.#replyTo,
			cc: [...this.#cc],
			bcc: [...this.#bcc],
			headers: { ...this.#headers }
		};
	}
}

/**
 * What a {@link MailMessage} holds.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type MailMessageContent = {
	readonly subject?: string;
	readonly greeting?: string;
	readonly parts: readonly MailPart[];
	readonly salutation?: string;
	readonly level: 'info' | 'success' | 'error';
	readonly view?: { readonly name: string; readonly data: Record<string, unknown> };
	readonly from?: MailAddress;
	readonly replyTo?: MailAddress;
	readonly cc: readonly MailAddress[];
	readonly bcc: readonly MailAddress[];
	readonly headers: Readonly<Record<string, string>>;
};

/**
 * What the `broadcast` channel emits: an event name and its data, for a WebSocket or a
 * server-sent events stream of the app to forward.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @example
 * ```ts
 * public broadcast() {
 * 	return new BroadcastMessage({ invoiceId: this.data.invoiceId }).as('invoice.paid');
 * }
 * ```
 */
export class BroadcastMessage {
	#event?: string;

	/**
	 * @param data The data of the event, JSON-safe.
	 */
	constructor(public readonly data: Record<string, unknown>) {}

	/** Names the event: the type of the notification by default. */
	public as(event: string): this {
		this.#event = event;
		return this;
	}

	/** The name of the event, when one was given. */
	public get event(): string | undefined {
		return this.#event;
	}
}

/**
 * What the `log` channel writes: a line of the application log and its context.
 * @author Axel Nana <ax.lnana@outlook.com>
 * @example
 * ```ts
 * public log() {
 * 	return new LogMessage('An invoice was paid', { invoiceId: this.data.invoiceId });
 * }
 * ```
 */
export class LogMessage {
	#level: 'debug' | 'info' | 'warn' | 'error' = 'info';

	/**
	 * @param text The line.
	 * @param context What the line adds to the log.
	 */
	constructor(
		public readonly text: string,
		public readonly context: Record<string, unknown> = {}
	) {}

	/** Sets the level of the line: `info` by default. */
	public level(level: 'debug' | 'info' | 'warn' | 'error'): this {
		this.#level = level;
		return this;
	}

	/** The level of the line. */
	public get severity(): 'debug' | 'info' | 'warn' | 'error' {
		return this.#level;
	}
}
