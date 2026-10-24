import { random } from 'radash';

import { Job } from '@elysiumjs/heracles';

@Job.register({ queue: 'email', name: 'send-email' })
export class EmailJob extends Job {
	constructor(
		private readonly recipient: string,
		private readonly message: string
	) {
		super();
	}

	protected async execute(): Promise<void> {
		this.info(`Sending email to ${this.recipient}`);
		await Bun.sleep(random(5000, 10000));
		this.success('Email sent successfully with message: ' + this.message);
	}
}
