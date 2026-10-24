import { Job } from '@elysiumjs/heracles';

@Job.register()
export class FailingJob extends Job {
	constructor(private readonly autoCancel: boolean) {
		super();
	}

	protected async execute(): Promise<void> {
		if (this.autoCancel) {
			this.cancel(); // Manually cancelled jobs should not be retried
		}

		throw new Error('Email sending is not implemented');
	}
}
