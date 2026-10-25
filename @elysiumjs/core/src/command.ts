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

import type { Class } from 'type-fest';

import { isArray, trim } from 'radash';

import { ConsoleFormat, InteractsWithConsole } from './console';
import { Metadata } from './metadata';
import { Symbols } from './utils';

/**
 * Supported command argument types.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export enum CommandArgumentType {
	/**
	 * String argument.
	 */
	STRING = 'string',

	/**
	 * Number argument.
	 */
	NUMBER = 'number',

	/**
	 * Boolean argument.
	 */
	BOOLEAN = 'boolean',

	/**
	 * Enum argument.
	 */
	ENUM = 'enum',

	/**
	 * Array argument.
	 */
	ARRAY = 'array'
}

/**
 * Properties required when declaring a command argument.
 * @author Axel Nana <axel.nana@workbud.com>
 *
 * These properties are used to define command arguments using the `@arg()` decorator. The
 * values of these properties are used to generate the help message for the command.
 */
export type CommandArgumentProps = {
	/**
	 * The name of the argument.
	 */
	name: string;

	/**
	 * The description of the argument.
	 */
	description?: string;

	/**
	 * Whether the argument is required.
	 */
	required?: boolean;

	/**
	 * The default value for the argument.
	 */
	default?: any;

	/**
	 * The type of the argument.
	 */
	type?: CommandArgumentType;

	/**
	 * The list of allowed values for the argument.
	 */
	enum?: string[];

	/**
	 * The type of elements in the array.
	 */
	arrayType?: CommandArgumentType; // Type of elements in the array
};

/**
 * Metadata for storing command arguments.
 * @author Axel Nana <axel.nana@workbud.com>
 */
type CommandArgumentMetadata = CommandArgumentProps & {
	/**
	 * The name of the class property that the argument is associated with.
	 */
	propertyKey: string;
};

/**
 * Type for a command class.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type CommandClass<T extends Command = Command> = Class<T> & {
	/**
	 * The name of the command.
	 */
	readonly command: string;

	/**
	 * The description of the command.
	 */
	readonly description: string;

	/**
	 * Whether the command is only available in development mode.
	 */
	readonly dev: boolean;

	/**
	 * Whether the application is booted eagerly before the command runs.
	 */
	readonly boot: boolean;
};

/**
 * Gets the name a command is invoked by: the `name` given to `@Command.register()`,
 * or else the static `command`.
 * @param cls The command class.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export function getCommandName(cls: Class<any>): string {
	const options: { name?: string } | undefined = Metadata.get(Symbols.command, cls);
	return options?.name ?? (cls as unknown as CommandClass).command;
}

/**
 * Base class for commands.
 *
 * Commands are classes that can be executed through the CLI. They can have arguments
 * that can be passed to them using the `--` syntax.
 *
 * @author Axel Nana <axel.nana@workbud.com>
 */
export abstract class Command extends InteractsWithConsole {
	//#region Command Interface

	/**
	 * The name of the command.
	 *
	 * This is used to identify the command in the CLI when using the `exec` command.
	 */
	public static readonly command: string = 'command';

	/**
	 * The description of the command.
	 *
	 * This is displayed when displaying help messages for the command.
	 */
	public static readonly description: string = 'Command description';

	/**
	 * Whether the command is only available in development mode.
	 * When set to `true`, the command will not be available in production builds.
	 */
	public static readonly dev: boolean = false;

	/**
	 * Whether the whole application is booted before the command runs.
	 * When `true`, every module is initialised and every service constructed first,
	 * as for `serve`. Otherwise modules are initialised lazily, on demand.
	 */
	public static readonly boot: boolean = false;

	/**
	 * Marks a class as a command. Records metadata only: the command still has to be
	 * listed in the `commands` of a module to be available in the CLI.
	 *
	 * @param options Optional registration options.
	 * @author Axel Nana <axel.nana@workbud.com>
	 */
	public static register(options: { name?: string } = {}): ClassDecorator {
		return function (target) {
			Metadata.define(Symbols.command, options, target);
		} as ClassDecorator;
	}

	/**
	 * Decorator for registering a command argument.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param name The name of the argument.
	 * @param props Additional options for the argument.
	 */
	public static arg(props: Partial<CommandArgumentProps> = {}): PropertyDecorator {
		return function (target, propertyKey) {
			const args: CommandArgumentMetadata[] = Metadata.get(Symbols.arg, target.constructor) ?? [];

			const propertyType = Metadata.get('design:type', target, propertyKey);

			// Infer argument type from property type if not explicitly specified
			let inferredType = props.type;

			if (!inferredType && propertyType) {
				if (propertyType === Array) {
					inferredType = CommandArgumentType.ARRAY;

					if (!props.arrayType) {
						props = {
							...props,
							arrayType: CommandArgumentType.STRING
						};
					}
				} else if (propertyType.constructor !== Object) {
					switch (propertyType.name.toLowerCase()) {
						case 'number':
							inferredType = CommandArgumentType.NUMBER;
							break;
						case 'boolean':
							inferredType = CommandArgumentType.BOOLEAN;
							break;
						case 'string':
							inferredType = CommandArgumentType.STRING;
							break;
						default:
							inferredType = undefined;
					}
				}
				// Check if it's an enum by examining if the property type has values
				else if (Object.values(propertyType).length > 0) {
					inferredType = CommandArgumentType.ENUM;

					if (!props.enum) {
						props = {
							...props,
							enum: Object.values(propertyType)
						};
					}
				}
			}

			args.push({
				name: props.name ?? (propertyKey as string),
				description: props.description,
				required: props.required ?? false,
				default: props.default,
				type: inferredType,
				enum: props.enum,
				arrayType: props.arrayType,
				propertyKey: propertyKey as string
			});

			Metadata.define(Symbols.arg, args, target.constructor);
		};
	}

	/**
	 * The command entry point. This method is called when the command is executed using the CLI.
	 */
	public abstract run(): Promise<void>;

	/**
	 * Initialize the command before it is executed. This method is called before the `run()` method.
	 * and is used to validate the arguments and initialize the command.
	 * @param argv The command line arguments.
	 * @returns Whether the command was initialized successfully.
	 */
	public async init(...argv: string[]): Promise<boolean> {
		const args = this.processArgs(argv);
		const validation = this.validateArgs(args);

		if (!validation.valid) {
			if (validation.missing.length > 0) {
				console.error(`Missing required arguments: ${validation.missing.join(', ')}\n`);
			}

			return false;
		}

		// Return false if help argument is provided
		if (Object.keys(args).includes('help')) {
			return false;
		}

		// Map CLI arguments to class properties using propertyKey from metadata
		const commandArgs = this.getArguments();
		for (const arg of commandArgs) {
			if (args[arg.name] !== undefined) {
				// Use the propertyKey to set the correct class property
				(this as any)[arg.propertyKey] = args[arg.name];
			}
		}

		return true;
	}

	/**
	 * Get all registered arguments for this command.
	 * @returns The list of registered arguments.
	 */
	protected getArguments(): CommandArgumentMetadata[] {
		return Metadata.get(Symbols.arg, this.constructor) || [];
	}

	/**
	 * Generate help text for the command.
	 * @returns Formatted help text.
	 */
	public async help(): Promise<string> {
		let helpText = `${this.bold('Command:')} ${this.format((this.constructor as CommandClass).command, ConsoleFormat.MAGENTA)}\n`;
		helpText += `${this.bold('Description:')} ${(this.constructor as CommandClass).description}\n\n`;

		const args = this.getArguments();

		if (args.length > 0) {
			helpText += `${this.bold('Arguments:')}\n`;

			for (const arg of args) {
				const requiredText = this.format(
					arg.required ? '(required)' : '(optional)',
					ConsoleFormat.RED,
					ConsoleFormat.BOLD
				);
				const defaultText =
					arg.default !== undefined
						? this.format(`[default: ${arg.default}]`, ConsoleFormat.GRAY, ConsoleFormat.ITALIC)
						: '';

				// Generate type text
				let typeText = '';
				if (arg.type === CommandArgumentType.ARRAY) {
					typeText = `<array of ${arg.arrayType || 'string'}s>`;
				} else if (arg.type) {
					typeText = `<${arg.type}>`;
				}

				// Add enum values to help text if applicable
				const enumText = arg.enum ? ` [${arg.enum.join('|')}]` : '';

				helpText += ` ${this.format(`--${arg.name}`, ConsoleFormat.CYAN)} ${typeText}${enumText} ${requiredText} ${defaultText}\n`;

				if (arg.description) {
					helpText += `    ${arg.description}\n\n`;
				}
			}
		} else {
			helpText += 'This command has no arguments.\n';
		}

		return trim(helpText, '\n');
	}

	/**
	 * Validate provided arguments against registered arguments.
	 * @param args Arguments to validate.
	 * @returns Object with validation result and missing required args if any.
	 */
	protected validateArgs(args: Record<string, any>): { valid: boolean; missing: string[] } {
		const missing: string[] = [];
		const invalid: string[] = [];
		const commandArgs = this.getArguments();

		// Skip validation if help argument is provided
		if (Object.keys(args).includes('help')) {
			return { valid: true, missing: [] };
		}

		for (const arg of commandArgs) {
			// Check for missing required arguments
			if (arg.required && (args[arg.name] === undefined || args[arg.name] === null)) {
				missing.push(arg.name);
				continue;
			}

			// Skip validation if argument is not provided
			if (args[arg.name] === undefined) {
				continue;
			}

			// Validate enum values
			if (arg.type === CommandArgumentType.ENUM && arg.enum && !arg.enum.includes(args[arg.name])) {
				invalid.push(`${arg.name} (must be one of: ${arg.enum.join(', ')})`);
			}

			// Validate array of enum values
			if (
				arg.type === CommandArgumentType.ARRAY &&
				arg.arrayType === CommandArgumentType.ENUM &&
				arg.enum
			) {
				const invalidItems = (args[arg.name] as any[]).filter((item) => !arg.enum!.includes(item));
				if (invalidItems.length > 0) {
					invalid.push(
						`${arg.name} (contains invalid values: ${invalidItems.join(', ')}. Must be one of: ${arg.enum.join(', ')})`
					);
				}
			}
		}

		if (invalid.length > 0) {
			console.error(`Invalid argument values: ${invalid.join(', ')}\n`);
		}

		return {
			valid: missing.length === 0 && invalid.length === 0,
			missing
		};
	}

	/**
	 * Process command line arguments and apply default values.
	 * @param argv The command line arguments.
	 * @returns Processed arguments with defaults applied.
	 */
	protected processArgs(argv: string[]): Record<string, any> {
		const processed: Record<string, any> = {};
		const commandArgs = this.getArguments();

		// Process command line arguments
		for (let i = 0; i < argv.length; i++) {
			const arg = argv[i];

			// Check if it's an argument (starts with --)
			if (arg.startsWith('--')) {
				const argName = arg.slice(2); // Remove -- prefix

				// Check if the next item is a value (not another argument)
				if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
					processed[argName] = argv[i + 1];
					i++; // Skip the value in the next iteration
				} else {
					// Flag argument (boolean)
					processed[argName] = true;
				}
			}
		}

		// Apply default values and type conversions
		for (const arg of commandArgs) {
			// Apply default values for missing arguments
			if (processed[arg.name] === undefined && arg.default !== undefined) {
				processed[arg.name] = arg.default;
				continue;
			}

			// Skip if no value to convert
			if (processed[arg.name] === undefined) {
				continue;
			}

			// Convert values based on type
			if (typeof processed[arg.name] === 'string') {
				// Determine the type to convert to
				const type = arg.type || this.inferType(arg.default);

				switch (type) {
					case CommandArgumentType.NUMBER:
						processed[arg.name] = Number(processed[arg.name]);
						break;

					case CommandArgumentType.BOOLEAN:
						const value = processed[arg.name].toLowerCase();
						processed[arg.name] = value === 'true' || value === '1' || value === 'yes';
						break;

					case CommandArgumentType.ENUM:
						// For enum types, we keep the string value but validate it in validateArgs
						// If it's a number enum, convert to number
						if (arg.enum && arg.enum.length > 0 && typeof arg.enum[0] === 'number') {
							processed[arg.name] = Number(processed[arg.name]);
						}
						break;

					case CommandArgumentType.ARRAY:
						// Split comma-separated values into an array
						const arrayValues = processed[arg.name].split(',').map((item: string) => item.trim());

						// Convert array elements based on arrayType
						if (arg.arrayType) {
							processed[arg.name] = arrayValues.map((item: string) => {
								switch (arg.arrayType) {
									case CommandArgumentType.NUMBER:
										return Number(item);
									case CommandArgumentType.BOOLEAN:
										return (
											item.toLowerCase() === 'true' ||
											item.toLowerCase() === '1' ||
											item.toLowerCase() === 'yes'
										);
									case CommandArgumentType.ENUM:
										// For enum arrays, validate each value in validateArgs
										return item;
									default:
										return item; // Default to string
								}
							});
						} else {
							processed[arg.name] = arrayValues; // Default to string array
						}
						break;

					case CommandArgumentType.STRING:
					default:
						// Keep as string
						break;
				}
			}
		}

		return processed;
	}

	//#endregion

	//#region UI

	/**
	 * Start a progress bar in the console.
	 * @param total The total number of items to process.
	 * @param title Optional title for the progress bar.
	 */
	protected progress(total: number, title: string = 'Processing'): CommandProgressBar {
		return new CommandProgressBar(total, title);
	}

	/**
	 * Start a spinner in the console.
	 * @param title Optional title for the spinner.
	 * @param frames Optional custom frames for the spinner animation.
	 * @param frameDelay Optional delay between frames in milliseconds.
	 */
	protected spinner(
		title: string = 'Processing',
		frames?: string[],
		frameDelay?: number
	): CommandSpinner {
		return new CommandSpinner(title, frames, frameDelay);
	}

	//#endregion

	//#region Utilities

	/**
	 * Infer the type of an argument based on its default value.
	 * @param defaultValue The default value.
	 * @returns The inferred argument type.
	 */
	private inferType(defaultValue: any): CommandArgumentType {
		if (defaultValue === undefined) {
			return CommandArgumentType.STRING;
		}

		const type = typeof defaultValue;

		switch (type) {
			case 'number':
				return CommandArgumentType.NUMBER;
			case 'boolean':
				return CommandArgumentType.BOOLEAN;
			default:
				return isArray(defaultValue) ? CommandArgumentType.ARRAY : CommandArgumentType.STRING;
		}
	}

	//#endregion
}

/**
 * A class for managing and displaying a progress bar in the console.
 * @author Axel Nana <axel.nana@workbud.com>
 */
class CommandProgressBar extends InteractsWithConsole {
	/**
	 * Whether the progress bar is currently active.
	 */
	#active: boolean = false;

	/**
	 * The total number of steps to process.
	 */
	#total: number = 0;

	/**
	 * The current progress value.
	 * This is incremented by the `update()` method.
	 */
	#current: number = 0;

	/**
	 * The title of the progress bar.
	 */
	#title: string = '';

	/**
	 * The start time of the progress bar.
	 */
	#startTime: number = 0;

	/**
	 * Create a new progress bar instance.
	 * @param total The total number of items to process.
	 * @param title Optional title for the progress bar.
	 */
	constructor(total: number = 0, title: string = 'Processing') {
		super();

		this.#total = total;
		this.#title = title;

		this.#active = true;
		this.#current = 0;
		this.#startTime = Date.now();

		// Draw initial progress bar
		this.update(0);
	}

	/**
	 * Update the progress bar with a new value.
	 * @param increment The number of items to increment by (default: 1).
	 * @param newTitle Optional new title for the progress bar.
	 */
	public update(increment: number = 1, newTitle?: string): void {
		if (!this.#active) return;

		// Update progress
		this.#current += increment;
		if (newTitle) this.#title = newTitle;

		// Calculate percentage
		const percentage = Math.min(100, Math.floor((this.#current / this.#total) * 100));

		// Calculate elapsed time and estimated time remaining
		const elapsedMs = Date.now() - this.#startTime;
		const elapsedSec = elapsedMs / 1000;

		let estimatedTotalSec = 0;
		let estimatedRemainingSec = 0;
		let timeInfo = '';

		if (this.#current > 0) {
			estimatedTotalSec = (elapsedSec / this.#current) * this.#total;
			estimatedRemainingSec = Math.max(0, estimatedTotalSec - elapsedSec);

			timeInfo = ` | ${this.formatTime(elapsedSec)} elapsed | ${this.formatTime(estimatedRemainingSec)} remaining`;
		}

		// Create the progress bar
		const barWidth = 30;
		const completedWidth = Math.floor((percentage / 100) * barWidth);
		const remainingWidth = barWidth - completedWidth;

		const bar =
			'[' +
			'='.repeat(completedWidth) +
			(remainingWidth > 0 ? '>' : '') +
			' '.repeat(Math.max(0, remainingWidth - (remainingWidth > 0 ? 1 : 0))) +
			']';

		// Create the full progress line
		const progressLine = `${this.#title}: ${bar} ${percentage}% (${this.#current}/${this.#total})${timeInfo}`;

		// Clear the current line and write the new progress
		this.clearLine();
		this.write(progressLine, false);

		// If we're done, add a newline
		if (this.#current >= this.#total) {
			this.complete();
		}
	}

	/**
	 * Complete the progress bar and reset its state.
	 * @param message Optional completion message to display.
	 */
	public complete(message?: string): void {
		if (!this.#active) return;

		// Ensure we show 100% completion
		this.#current = this.#total;

		// Calculate final elapsed time
		const elapsedMs = Date.now() - this.#startTime;
		const elapsedSec = elapsedMs / 1000;

		// Clear the current line
		this.clearLine();

		// Write completion message
		if (message) {
			this.write(`${message} (completed in ${this.formatTime(elapsedSec)})`);
		} else {
			this.write(`${this.#title} completed in ${this.formatTime(elapsedSec)}`);
		}

		// Reset progress bar state
		this.#active = false;
	}

	/**
	 * Pause the progress bar temporarily to display a message.
	 * @param message The message to display.
	 */
	public pause(message: string): void {
		if (!this.#active) return;

		// Add a newline to move below the progress bar
		this.newLine();

		// Display the message
		this.write(message);

		// Redraw the progress bar
		this.update(0);
	}

	/**
	 * Check if the progress bar is currently active.
	 * @returns True if the progress bar is active, false otherwise.
	 */
	public isActive(): boolean {
		return this.#active;
	}

	/**
	 * Get the current progress value.
	 * @returns The current progress value.
	 */
	public getCurrent(): number {
		return this.#current;
	}

	/**
	 * Get the total progress value.
	 * @returns The total progress value.
	 */
	public getTotal(): number {
		return this.#total;
	}

	/**
	 * Get the current progress percentage.
	 * @returns The current progress percentage (0-100).
	 */
	public getPercentage(): number {
		return Math.min(100, Math.floor((this.#current / this.#total) * 100));
	}
}

/**
 * A class for displaying a spinner in the console for indeterminate operations.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class CommandSpinner extends InteractsWithConsole {
	/**
	 * Whether the spinner is currently active.
	 */
	#active: boolean = false;

	/**
	 * The title for the spinner.
	 */
	#title: string = '';

	/**
	 * The start time of the spinner.
	 */
	#startTime: number = 0;

	/**
	 * The interval ID for the spinner animation.
	 */
	#intervalId: Timer | null = null;

	/**
	 * The current frame of the spinner.
	 */
	#currentFrame: number = 0;

	/**
	 * The custom frames for the spinner animation.
	 */
	readonly #frames: string[] = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

	/**
	 * The delay between frames in milliseconds.
	 */
	readonly #frameDelay: number = 80; // milliseconds between frames

	/**
	 * Create a new spinner instance.
	 * @param title Optional title for the spinner.
	 * @param frames Optional custom frames for the spinner animation.
	 * @param frameDelay Optional delay between frames in milliseconds.
	 */
	constructor(title: string = 'Processing', frames?: string[], frameDelay?: number) {
		super();

		this.#title = title;
		if (frames) this.#frames = frames;
		if (frameDelay) this.#frameDelay = frameDelay;

		if (this.#active) return;

		this.#active = true;
		this.#startTime = Date.now();
		this.#currentFrame = 0;

		// Start the animation
		this.#intervalId = setInterval(() => {
			this.render();
		}, this.#frameDelay);

		// Initial render
		this.render();
	}

	/**
	 * Update the spinner with a new title.
	 * @param newTitle New title for the spinner.
	 */
	public update(newTitle: string): void {
		if (!this.#active) return;
		this.#title = newTitle;
	}

	/**
	 * Complete the spinner and reset its state.
	 * @param message Optional completion message to display.
	 * @param success Whether the operation was successful (affects the symbol shown).
	 */
	public complete(message?: string, success: boolean = true): void {
		if (!this.#active) return;

		// Stop the animation
		if (this.#intervalId) {
			clearInterval(this.#intervalId);
			this.#intervalId = null;
		}

		// Calculate elapsed time
		const elapsedMs = Date.now() - this.#startTime;
		const elapsedSec = elapsedMs / 1000;

		// Clear the current line
		this.clearLine();

		// Determine completion symbol
		const time = this.formatTime(elapsedSec);

		// Write the completion message
		if (message) {
			this[success ? 'success' : 'error'](`${message} (${time})`);
		} else {
			this[success ? 'success' : 'error'](`${this.#title} completed in ${time}`);
		}

		// Reset spinner state
		this.#active = false;
	}

	/**
	 * Fail the spinner and reset its state.
	 * @param message Optional failure message to display.
	 */
	public fail(message?: string): void {
		this.complete(message, false);
	}

	/**
	 * Pause the spinner temporarily to display a message.
	 * @param message The message to display.
	 */
	public pause(message: string): void {
		if (!this.#active) return;

		// Temporarily stop the animation
		if (this.#intervalId) {
			clearInterval(this.#intervalId);
			this.#intervalId = null;
		}

		// Clear the current line
		this.clearLine();

		// Display the message
		this.write(message);

		// Restart the animation
		this.#intervalId = setInterval(() => {
			this.render();
		}, this.#frameDelay);
	}

	/**
	 * Check if the spinner is currently active.
	 * @returns True if the spinner is active, false otherwise.
	 */
	public isActive(): boolean {
		return this.#active;
	}

	/**
	 * Get the elapsed time since the spinner started.
	 * @returns The elapsed time in seconds.
	 */
	public getElapsedTime(): number {
		return (Date.now() - this.#startTime) / 1000;
	}

	/**
	 * Render the current frame of the spinner.
	 */
	private render(): void {
		if (!this.#active) return;

		// Calculate elapsed time
		const elapsedSec = this.getElapsedTime();

		// Get the current frame
		const frame = this.#frames[this.#currentFrame];

		// Increment frame counter
		this.#currentFrame = (this.#currentFrame + 1) % this.#frames.length;

		// Clear the current line
		this.clearLine();

		// Write the spinner frame and title
		this.write(`${frame} ${this.#title} (${this.formatTime(elapsedSec)})`, false);
	}
}
