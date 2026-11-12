import { Command, CommandArgumentType } from '@elysiumjs/core';

/**
 * A command that demonstrates the use of the progress bar for operations with known steps.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
@Command.register()
export class ProgressDemoCommand extends Command {
	public static readonly command: string = 'demo:progress';
	public static readonly description: string =
		'Demonstrates the use of progress bars for operations with known steps';

	@Command.arg({
		description: 'The type of task to simulate',
		default: 'file',
		enum: ['file', 'database', 'import', 'export', 'batch'],
		type: CommandArgumentType.ENUM
	})
	private task: string = 'file';

	@Command.arg({
		description: 'Number of items to process',
		type: CommandArgumentType.NUMBER,
		default: 100
	})
	private items: number = 100;

	@Command.arg({
		description: 'Delay between items in milliseconds',
		type: CommandArgumentType.NUMBER,
		default: 50
	})
	private delay: number = 50;

	@Command.arg({
		description: 'Simulate a failure during the operation',
		type: CommandArgumentType.BOOLEAN,
		default: false
	})
	private fail: boolean = false;

	/**
	 * Run the progress bar demo command.
	 */
	public async run(): Promise<void> {
		this.title('Progress Bar Demo');

		this.info(`Simulating a ${this.task} processing operation with ${this.items} items`);

		if (this.fail) {
			this.warning('This demo will simulate a failure');
		}

		try {
			// Create a progress bar
			const progress = this.progress(this.items, `Processing ${this.task} items`);

			// Process each item
			for (let i = 1; i <= this.items; i++) {
				// Simulate processing time
				await Bun.sleep(this.delay);

				// Update progress
				if (i % 10 === 0) {
					progress.update(
						1,
						`Processing ${this.task} items (batch ${Math.floor(i / 10)} of ${Math.floor(this.items / 10)})`
					);
				} else {
					progress.update(1);
				}

				// Occasionally pause to show a message
				if (i % 25 === 0) {
					progress.pause(`Checkpoint reached: ${i} items processed`);
				}

				// Simulate a failure if requested
				if (this.fail && i === Math.floor(this.items / 2)) {
					throw new Error(`Failed during ${this.task} processing at item ${i}`);
				}
			}

			// Show completion message
			this.success(`Successfully processed ${this.items} ${this.task} items`);

			// Show some stats
			this.info(`Average processing time: ${(this.delay / 1000).toFixed(2)}s per item`);
			this.info(`Total items: ${this.items}`);
		} catch (error: any) {
			this.newLine();
			this.error(`Operation failed: ${error.message}`);
			return;
		}

		// Ask if the user wants to run another demo
		if (await this.confirm('Would you like to run another progress demo?')) {
			// Let the user select a different task
			this.task = await this.select('Select a task to simulate:', [
				'file',
				'database',
				'import',
				'export',
				'batch'
			]);

			// Let the user input custom items count
			const itemsStr = await this.prompt('Enter number of items to process', '100');
			this.items = parseInt(itemsStr, 10) || 100;

			// Let the user input custom delay
			const delayStr = await this.prompt('Enter delay between items (ms)', '50');
			this.delay = parseInt(delayStr, 10) || 50;

			// Run again
			await this.run();
		} else {
			this.success('Demo completed. Thanks for trying out the progress bar!');
		}
	}
}
