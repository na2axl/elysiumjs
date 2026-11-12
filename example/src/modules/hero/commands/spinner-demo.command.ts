import { Command, CommandArgumentType } from '@elysiumjs/core';

/**
 * A command that demonstrates the use of the spinner for indeterminate operations.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
@Command.register()
export class SpinnerDemoCommand extends Command {
	public static readonly command: string = 'demo:spinner';
	public static readonly description: string =
		'Demonstrates the use of spinners for indeterminate operations';

	@Command.arg({
		description: 'The type of task to simulate',
		default: 'download',
		enum: ['download', 'process', 'connect', 'upload', 'analyze'],
		type: CommandArgumentType.ENUM
	})
	private task: string = 'download';

	@Command.arg({
		description: 'Duration of the simulated task in seconds',
		type: CommandArgumentType.NUMBER,
		default: 5
	})
	private duration: number = 5;

	@Command.arg({
		description: 'Number of steps in the simulated task',
		type: CommandArgumentType.NUMBER,
		default: 3
	})
	private steps: number = 3;

	@Command.arg({
		description: 'Simulate a failure during the operation',
		type: CommandArgumentType.BOOLEAN,
		default: false
	})
	private fail: boolean = false;

	/**
	 * Run the spinner demo command.
	 */
	public async run(): Promise<void> {
		this.title('Spinner Demo');

		this.info(
			`Simulating a ${this.task} operation with ${this.steps} steps over ${this.duration} seconds`
		);

		if (this.fail) {
			this.warning('This demo will simulate a failure');
			this.debug('Remove the --fail flag to see the actual operation');
		}

		// Calculate time per step
		const timePerStep = (this.duration * 1000) / this.steps;

		// Start a spinner
		const spinner = this.spinner(`Starting ${this.task} operation`);

		try {
			// Simulate multiple steps
			for (let i = 1; i <= this.steps; i++) {
				// Wait for the calculated time
				await this.delay(timePerStep);

				// Update spinner message for each step
				if (i < this.steps) {
					spinner.update(`${this.getTaskMessage(i)}`);
				}

				// Simulate a failure at a random step if fail flag is set
				if (this.fail && i === Math.floor(this.steps / 2)) {
					throw new Error(`Failed during ${this.task} operation at step ${i}`);
				}
			}

			// Complete the spinner with success
			spinner.complete(
				`${this.task.charAt(0).toUpperCase() + this.task.slice(1)} operation completed successfully`
			);

			// Show some additional information
			this.success(`Processed ${this.getRandomNumber(10, 100)} items`);
			this.info(`Peak memory usage: ${this.getRandomNumber(50, 200)}MB`);
		} catch (error: any) {
			// Handle failure
			spinner.fail(
				`${this.task.charAt(0).toUpperCase() + this.task.slice(1)} operation failed: ${error.message}`
			);
			this.error(`Error details: ${error.message}`);
			return;
		}

		// Ask if the user wants to run another simulation
		if (await this.confirm('Would you like to run another simulation?')) {
			// Let the user select a different task
			this.task = await this.select('Select a task to simulate:', [
				'download',
				'process',
				'connect',
				'upload',
				'analyze'
			]);

			// Let the user input a custom duration
			const durationStr = await this.prompt('Enter duration in seconds', '3');
			this.duration = parseInt(durationStr, 10) || 3;

			// Run again
			await this.run();
		} else {
			this.success('Demo completed. Thanks for trying out the spinner!');
		}
	}

	/**
	 * Get a task-specific message for the current step.
	 * @param step The current step number.
	 * @returns A message describing the current operation.
	 */
	private getTaskMessage(step: number): string {
		const messages: Record<string, string[]> = {
			download: [
				'Establishing connection',
				'Downloading data chunks',
				'Verifying file integrity',
				'Saving to disk'
			],
			process: [
				'Reading input files',
				'Processing data',
				'Applying transformations',
				'Generating output'
			],
			connect: [
				'Resolving hostname',
				'Establishing secure connection',
				'Authenticating',
				'Handshaking'
			],
			upload: ['Preparing files', 'Compressing data', 'Uploading chunks', 'Finalizing upload'],
			analyze: [
				'Loading dataset',
				'Running analysis algorithms',
				'Generating insights',
				'Preparing report'
			]
		};

		const taskMessages = messages[this.task] || messages['download'];
		return taskMessages[step % taskMessages.length];
	}

	/**
	 * Generate a random number between min and max (inclusive).
	 * @param min The minimum value.
	 * @param max The maximum value.
	 * @returns A random number.
	 */
	private getRandomNumber(min: number, max: number): number {
		return Math.floor(Math.random() * (max - min + 1)) + min;
	}

	/**
	 * Delay execution for the specified time.
	 * @param ms Time to delay in milliseconds.
	 * @returns A promise that resolves after the delay.
	 */
	private delay(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}
}
