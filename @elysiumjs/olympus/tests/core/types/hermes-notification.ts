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

// Compile-time checks of notifications: run by `bun run typecheck`.
import type { Notifiable } from '../../../src/hermes/index';

import { InboxMessage, MailMessage, Notification } from '../../../src/hermes/index';

@Notification.register({ type: 'types.welcome' })
export class Welcome extends Notification<{ name: string }> {
	public channels() {
		return ['inbox', ['mail', 'log']] as const;
	}

	public inbox() {
		return new InboxMessage({ name: this.data.name });
	}

	public mail(_notifiable: Notifiable) {
		return new MailMessage().subject(`Welcome ${this.data.name}`);
	}
}

@Notification.register({ type: 'types.ping' })
export class Ping extends Notification {
	public channels() {
		return ['log'] as const;
	}
}

// @ts-expect-error the mail channel takes a MailMessage
@Notification.register({ type: 'types.wrong' })
export class WrongMessage extends Notification {
	public channels() {
		return ['mail'] as const;
	}

	public mail() {
		return new InboxMessage({});
	}
}

// @ts-expect-error fax is not a declared channel
@Notification.register({ type: 'types.unknown' })
export class UnknownChannel extends Notification {
	// @ts-expect-error the class says so too
	public channels() {
		return ['fax'] as const;
	}
}

export const checks = async (user: Notifiable) => {
	new Ping();
	new Welcome({ name: 'Ada' });
	// @ts-expect-error the data is required
	new Welcome();
	// @ts-expect-error a notification without data takes none
	new Ping({});
	await Notification.send(user, new Ping());
	await Notification.route('mail', 'ada@example.com').notify(new Welcome({ name: 'Ada' }));
};
