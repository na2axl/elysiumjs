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

import type { OutputLevel } from './runtime';

import { isEmpty, omit } from 'radash';

import { Runtime, RuntimeNotSupportedError } from './runtime';

/**
 * ANSI color codes and styles for console output.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export enum ConsoleFormat {
	BLACK,
	RED,
	GREEN,
	YELLOW,
	BLUE,
	MAGENTA,
	CYAN,
	WHITE,
	GRAY,
	BOLD,
	UNDERLINE,
	ITALIC,
	INVERSE
}

/**
 * Loads `node:readline` when a prompt needs it, so that runtimes without the module
 * (Cloudflare Workers) can still load the console.
 */
// portability-allow: only reached after Runtime.terminal() returned a terminal, never on Workers
const loadReadline = () => import('node:readline');

/**
 * A map of console format codes to ANSI escape codes.
 * @author Axel Nana <axel.nana@workbud.com>
 */
const formatMap: Record<ConsoleFormat, string> = {
	[ConsoleFormat.BLACK]: '\x1b[30m',
	[ConsoleFormat.RED]: '\x1b[91m',
	[ConsoleFormat.GREEN]: '\x1b[32m',
	[ConsoleFormat.YELLOW]: '\x1b[93m',
	[ConsoleFormat.BLUE]: '\x1b[94m',
	[ConsoleFormat.MAGENTA]: '\x1b[95m',
	[ConsoleFormat.CYAN]: '\x1b[96m',
	[ConsoleFormat.WHITE]: '\x1b[97m',
	[ConsoleFormat.GRAY]: '\x1b[37m',
	[ConsoleFormat.BOLD]: '\x1b[1m',
	[ConsoleFormat.UNDERLINE]: '\x1b[4m',
	[ConsoleFormat.ITALIC]: '\x1b[3m',
	[ConsoleFormat.INVERSE]: '\x1b[7m'
};

const RESET = '\x1b[0m';

/**
 * The kinds of messages the level shortcuts of {@link InteractsWithConsole} write.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type ConsoleTag = 'debug' | 'info' | 'success' | 'warning' | 'error';

/**
 * The tag written before a message: its label and the styles of the label.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type ConsoleTagStyle = { label: string; styles: ConsoleFormat[] };

const DEFAULT_TAGS: Record<ConsoleTag, ConsoleTagStyle> = {
	debug: { label: '[D]', styles: [ConsoleFormat.GRAY] },
	info: { label: '[I]', styles: [ConsoleFormat.BLUE] },
	success: { label: '[S]', styles: [ConsoleFormat.GREEN] },
	warning: { label: '[W]', styles: [ConsoleFormat.YELLOW] },
	error: { label: '[E]', styles: [ConsoleFormat.RED] }
};

/** The level and the stream of each tag. */
const TAG_OUTPUT: Record<ConsoleTag, { level: OutputLevel; out: 'stdout' | 'stderr' }> = {
	debug: { level: 'debug', out: 'stdout' },
	info: { level: 'info', out: 'stdout' },
	success: { level: 'info', out: 'stdout' },
	warning: { level: 'warn', out: 'stdout' },
	error: { level: 'error', out: 'stderr' }
};

/** The console method of each level, for hosts that write through the console. */
const CONSOLE_METHODS: Record<OutputLevel, 'debug' | 'info' | 'warn' | 'error'> = {
	trace: 'debug',
	debug: 'debug',
	info: 'info',
	warn: 'warn',
	error: 'error',
	fatal: 'error'
};

const styled = (text: string, styles: ConsoleFormat[]): string =>
	styles.length === 0 ? text : `${styles.map((style) => formatMap[style]).join('')}${text}${RESET}`;

let tags = DEFAULT_TAGS;
let renderedTags: Record<ConsoleTag, string> | undefined;

/** The formatted tags, built once until they change. */
const rendered = (): Record<ConsoleTag, string> =>
	(renderedTags ??= Object.fromEntries(
		Object.entries(tags).map(([tag, { label, styles }]) => [tag, styled(label, styles)])
	) as Record<ConsoleTag, string>);

/**
 * A utility class for console IO with various formatting options.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class InteractsWithConsole {
	protected static readonly SPACE_WIDTH = 60;

	/**
	 * Changes the tags the level shortcuts write before their messages, for every console. A tag
	 * is a label, or a label and its styles; the tags left out keep their defaults (`[D]`, `[I]`,
	 * `[S]`, `[W]` and `[E]`, in gray, blue, green, yellow and red).
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @example
	 * ```ts
	 * InteractsWithConsole.useTags({ info: '[INFO]', error: { label: '[ERR]', styles: [ConsoleFormat.RED, ConsoleFormat.BOLD] } });
	 * ```
	 */
	public static useTags(custom: Partial<Record<ConsoleTag, string | ConsoleTagStyle>>): void {
		const next = { ...DEFAULT_TAGS };
		for (const [tag, value] of Object.entries(custom) as [ConsoleTag, string | ConsoleTagStyle][]) {
			next[tag] = typeof value === 'string' ? { ...DEFAULT_TAGS[tag], label: value } : value;
		}
		tags = next;
		renderedTags = undefined;
	}

	/** Restores the default tags. */
	public static resetTags(): void {
		tags = DEFAULT_TAGS;
		renderedTags = undefined;
	}

	/**
	 * Write a message to the console.
	 * @param message The message to write.
	 * @param newLine Whether to add a newline at the end (default: `true`).
	 * @param out The stream to write to (default: `'stdout'`). The runtime decides how it is
	 * written: hosts without streams, such as Cloudflare Workers, write to the console instead,
	 * and so does the framework when no runtime is set yet.
	 * @param level The level of the message. A host that writes through the console uses the
	 * console method of the level, so that its logs keep the level.
	 */
	public write(
		message: string,
		newLine: boolean = true,
		out: 'stdout' | 'stderr' = 'stdout',
		level?: OutputLevel
	): void {
		const runtime = Runtime.find();
		if (runtime) {
			runtime.write(out, newLine ? `${message}\n` : message, level);
			return;
		}
		const method = level ? CONSOLE_METHODS[level] : out === 'stderr' ? 'error' : 'log';
		globalThis.console[method](message);
	}

	/**
	 * Write a new line to the console.
	 */
	public newLine(): void {
		this.write('\n', false);
	}

	/** Writes a message after the tag of its kind, at the level and on the stream of that kind. */
	protected tagged(tag: ConsoleTag, message: string): void {
		const { level, out } = TAG_OUTPUT[tag];
		this.write(`${rendered()[tag]} ${message}`, true, out, level);
	}

	/**
	 * Write an info message to the console, after the `info` tag.
	 * @param message The message to write.
	 */
	public info(message: string): void {
		this.tagged('info', message);
	}

	/**
	 * Write a success message to the console, after the `success` tag.
	 * @param message The message to write.
	 */
	public success(message: string): void {
		this.tagged('success', message);
	}

	/**
	 * Write a warning message to the console, after the `warning` tag.
	 * @param message The message to write.
	 */
	public warning(message: string): void {
		this.tagged('warning', message);
	}

	/**
	 * Write an error message to the standard error stream, after the `error` tag.
	 * @param message The message to write.
	 */
	public error(message: string): void {
		this.tagged('error', message);
	}

	/**
	 * Write a debug message to the console, after the `debug` tag. Only written when the `DEBUG`
	 * environment variable is set.
	 * @param message The message to write.
	 */
	public debug(message: string): void {
		if (Runtime.find()?.env().DEBUG) this.tagged('debug', message);
	}

	/**
	 * Display a JavaScript error in the console with its message, stack trace,
	 * and any additional relevant information.
	 * @param error The error to display.
	 * @param title Optional title to display before the error message (default: '').
	 */
	public trace(error: Error & Record<string, any>, title?: string): void {
		if (!error) return;

		// Determine standard error information
		const errorName = error.name || 'Error';
		const errorMessage = error.message || 'An error occurred';
		const errorStack = error.stack || '';

		// Display the title if provided
		if (title) {
			this.title(title);
		} else {
			this.newLine();
		}

		// Display the error name and message in red
		this.write(
			this.format(`${errorName}: ${errorMessage}`, ConsoleFormat.RED),
			true,
			'stderr',
			'error'
		);

		if (error.stack) {
			// Display the stack trace in gray, each line prefixed by a tab for readability
			this.write(this.format('Stack Trace:', ConsoleFormat.BOLD), true, 'stderr', 'error');
			this.write(
				this.format(
					errorStack
						.split('\n')
						.map((line) => `\t${line}`)
						.join('\n'),
					ConsoleFormat.GRAY
				),
				true,
				'stderr',
				'error'
			);
		}

		// Display any other custom properties
		const customProps = omit(error, ['name', 'message', 'stack']);

		if (!isEmpty(customProps)) {
			this.write(
				this.format('Additional Information:', ConsoleFormat.BOLD),
				true,
				'stderr',
				'error'
			);
			for (const prop of Object.keys(customProps)) {
				this.write(`\t${prop}: ${JSON.stringify(error[prop])}`, true, 'stderr', 'error');
			}
		}

		this.newLine();
	}

	/**
	 * Write a title to the console (bold text with underline).
	 * @param title The title to write.
	 */
	public title(title: string): void {
		this.newLine();
		this.write(this.format(title, ConsoleFormat.BOLD, ConsoleFormat.UNDERLINE));
		this.newLine();
	}

	/**
	 * Write a section header to the console (bold text).
	 * @param header The section header to write.
	 */
	public section(header: string): void {
		this.newLine();
		this.write(this.bold(header));
	}

	/**
	 * Create a table from an array of objects and write it to the console.
	 * @param data The array of objects to display.
	 * @param columns Optional column configuration.
	 */
	public table<T extends Record<string, any>>(
		data: T[],
		columns?: {
			[K in keyof T]?: {
				header?: string;
				width?: number;
				format?: (value: T[K]) => string;
			};
		}
	): void {
		if (data.length === 0) {
			this.info('No data to display');
			return;
		}

		// Determine columns to display
		const keys = Object.keys(columns || data[0]) as (keyof T)[];

		// Calculate column widths
		const widths: Record<string, number> = {};
		for (const key of keys) {
			const columnConfig = columns?.[key];
			if (columnConfig?.width) {
				widths[key as string] = columnConfig.width;
				continue;
			}

			// Get header length
			const headerLength = (columnConfig?.header || String(key)).length;

			// Get max data length
			const maxDataLength = Math.max(
				...data.map((row) => {
					const value = row[key];
					if (columnConfig?.format) {
						return columnConfig.format(value).length;
					}
					return String(value === null || value === undefined ? '' : value).length;
				})
			);

			widths[key as string] = Math.max(headerLength, maxDataLength);
		}

		// Create header row
		let header = '';
		let separator = '';
		for (const key of keys) {
			const columnConfig = columns?.[key];
			const headerText = columnConfig?.header || String(key);
			const width = widths[key as string];

			header += `| ${headerText.padEnd(width)} `;
			separator += `| ${'-'.repeat(width)} `;
		}
		header += '|';
		separator += '|';

		this.write(header);
		this.write(separator);

		// Create data rows
		for (const row of data) {
			let line = '';
			for (const key of keys) {
				const columnConfig = columns?.[key];
				const width = widths[key as string];
				const value = row[key];

				let displayValue: string;
				if (columnConfig?.format) {
					displayValue = columnConfig.format(value);
				} else {
					displayValue = String(value === null || value === undefined ? '' : value);
				}

				line += `| ${displayValue.padEnd(width)} `;
			}
			line += '|';
			this.write(line);
		}

		this.newLine();
	}

	/**
	 * Format text with multiple ANSI styles.
	 * @param text The text to format.
	 * @param styles The styles to apply.
	 * @returns The formatted text.
	 */
	public format(text: string, ...styles: ConsoleFormat[]): string {
		return styled(text, styles);
	}

	/**
	 * Format text as bold.
	 * @param text The text to format.
	 * @returns The formatted text.
	 */
	public bold(text: string): string {
		return this.format(text, ConsoleFormat.BOLD);
	}

	/**
	 * Format text as italic.
	 * @param text The text to format.
	 * @returns The formatted text.
	 */
	public italic(text: string): string {
		return this.format(text, ConsoleFormat.ITALIC);
	}

	/**
	 * Format text as underline.
	 * @param text The text to format.
	 * @returns The formatted text.
	 */
	public underline(text: string): string {
		return this.format(text, ConsoleFormat.UNDERLINE);
	}

	/**
	 * Clear the console screen.
	 */
	public clear(): void {
		this.terminal().clear();
	}

	/**
	 * Move the cursor to a specific position.
	 * @param x The x coordinate (column).
	 * @param y The y coordinate (row).
	 */
	public moveCursor(x: number, y: number): void {
		this.terminal().moveCursor(x, y);
	}

	/**
	 * Clear the current line in the console.
	 */
	public clearLine(): void {
		this.terminal().clearLine();
	}

	/**
	 * Whether the runtime has an interactive terminal. Without one, spinners and progress bars
	 * write plain lines instead of redrawing the current one.
	 */
	public isInteractive(): boolean {
		return Runtime.get().terminal() !== undefined;
	}

	/**
	 * Gets the interactive terminal of the runtime.
	 * @throws {RuntimeNotSupportedError} When the runtime has no terminal.
	 */
	private terminal() {
		const runtime = Runtime.get();
		const terminal = runtime.terminal();
		if (!terminal) throw new RuntimeNotSupportedError('Interactive console', runtime.name);
		return terminal;
	}

	// User Input Methods

	/**
	 * Prompt the user for input.
	 * @param question The question to ask.
	 * @param defaultValue Optional default value.
	 * @returns The user's input.
	 */
	protected async prompt(question: string, defaultValue?: string): Promise<string> {
		const terminal = this.terminal();
		const readline = await loadReadline();
		const rl = readline.createInterface({
			input: terminal.input,
			output: terminal.output
		});

		const defaultText = defaultValue ? ` (default: ${defaultValue})` : '';

		return new Promise<string>((resolve) => {
			rl.question(`${question}${defaultText}: `, (answer) => {
				rl.close();
				resolve(answer || defaultValue || '');
			});
		});
	}

	/**
	 * Prompt the user for a password (input is hidden).
	 * @param question The question to ask.
	 * @returns The user's password.
	 */
	protected async promptPassword(question: string): Promise<string> {
		// Create readline interface
		const terminal = this.terminal();
		const readline = await loadReadline();
		const rl = readline.createInterface({
			input: terminal.input,
			output: terminal.output
		});

		// Mute stdin echo
		terminal.setRawMode?.(true);

		return new Promise<string>((resolve) => {
			let password = '';

			// Write question
			terminal.output.write(`${question}: `);

			// Handle keypress events
			terminal.input.on('data', (data: Buffer | string) => {
				const char = data.toString();

				// Check for Enter key (carriage return)
				if (char === '\r' || char === '\n') {
					terminal.output.write('\n');
					terminal.setRawMode?.(false);
					terminal.input.removeAllListeners('data');
					rl.close();
					resolve(password);
					return;
				}

				// Check for backspace
				if (char === '\b' || char === '\x7f') {
					if (password.length > 0) {
						password = password.slice(0, -1);
						terminal.output.write('\b \b'); // Erase character from terminal
					}
					return;
				}

				// Add character to password
				password += char;
				terminal.output.write('*'); // Show asterisk instead of actual character
			});
		});
	}

	/**
	 * Prompt the user for confirmation (yes/no).
	 * @param question The question to ask.
	 * @param defaultValue Optional default value (true for yes, false for no).
	 * @returns True if the user confirmed, false otherwise.
	 */
	protected async confirm(question: string, defaultValue: boolean = false): Promise<boolean> {
		const defaultText = defaultValue ? 'Y/n' : 'y/N';
		const answer = await this.prompt(`${question} [${defaultText}]`);

		if (!answer) {
			return defaultValue;
		}

		return answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes';
	}

	/**
	 * Prompt the user to select from a list of options.
	 * @param question The question to ask.
	 * @param options The options to choose from.
	 * @param defaultIndex Optional default option index.
	 * @returns The selected option.
	 */
	protected async select<T extends string>(
		question: string,
		options: T[],
		defaultIndex: number = 0
	): Promise<T> {
		if (options.length === 0) {
			throw new Error('No options provided for selection');
		}

		// Display options
		this.write(question);
		options.forEach((option, index) => {
			const isDefault = index === defaultIndex;
			this.write(`  ${index + 1}. ${option}${isDefault ? ' (default)' : ''}`);
		});

		// Get user selection
		const selection = await this.prompt('Enter your choice (number)');

		// Parse selection
		if (!selection) {
			return options[defaultIndex];
		}

		const index = parseInt(selection, 10) - 1;
		if (isNaN(index) || index < 0 || index >= options.length) {
			this.warning(`Invalid selection. Using default: ${options[defaultIndex]}`);
			return options[defaultIndex];
		}

		return options[index];
	}

	/**
	 * Format a time value in seconds to a human-readable string.
	 * @param seconds The time value in seconds.
	 * @returns A formatted time string.
	 */
	protected formatTime(seconds: number): string {
		if (seconds < 60) return `${seconds.toFixed(1)}s`;
		if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`;
		return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
	}
}
