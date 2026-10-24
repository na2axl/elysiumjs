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

import { afterAll, afterEach, beforeEach, describe, expect, it, jest, mock, spyOn } from 'bun:test';

import { Command, CommandArgumentType, CommandSpinner, getCommandName } from '../src/command';
import { Container } from '../src/container';
import { Symbols } from '../src/utils';

// Test Command.arg decorator
describe('@Command.arg decorator', () => {
	afterAll(() => {
		mock.restore();
	});

	it('should set metadata on the target class', () => {
		// Create a test class with a decorated property
		class TestCommand extends Command {
			@Command.arg({
				name: 'test-arg',
				description: 'Test argument',
				required: true,
				type: CommandArgumentType.STRING
			})
			testArg: string = '';

			public async run(): Promise<void> {
				// Implementation isn't needed for this test
			}
		}

		new TestCommand();

		// Get the metadata
		const args = Reflect.getMetadata(Symbols.arg, TestCommand);

		// Check if metadata was set correctly
		expect(args).toBeDefined();
		expect(args).toBeArrayOfSize(1);
		expect(args[0].name).toBe('test-arg');
		expect(args[0].description).toBe('Test argument');
		expect(args[0].required).toBe(true);
		expect(args[0].type).toBe(CommandArgumentType.STRING);
		expect(args[0].propertyKey).toBe('testArg');
	});

	it('should infer argument type from property type', () => {
		enum TestEnum {
			ONE,
			TWO,
			THREE
		}

		// Create a test class with properties of different types
		class TestCommand extends Command {
			@Command.arg()
			stringArg: string = '';

			@Command.arg()
			numberArg: number = 0;

			@Command.arg()
			booleanArg: boolean = false;

			@Command.arg()
			arrayArg: string[] = [];

			@Command.arg()
			enumArg: TestEnum = TestEnum.ONE;

			@Command.arg({
				default: 'default-value'
			})
			unknownArg = null;

			public async run(): Promise<void> {
				// Implementation not needed for this test
			}
		}

		new TestCommand();

		// Get the metadata
		const args = Reflect.getMetadata(Symbols.arg, TestCommand);

		// Check if types were inferred correctly
		expect(args).toBeArrayOfSize(6);
		expect(args[0].type).toBe(CommandArgumentType.STRING);
		expect(args[1].type).toBe(CommandArgumentType.NUMBER);
		expect(args[2].type).toBe(CommandArgumentType.BOOLEAN);
		expect(args[3].type).toBe(CommandArgumentType.ARRAY);
		expect(args[4].type).toBe(CommandArgumentType.ENUM);
		expect(args[5].type).toBeUndefined();
	});

	it('should use property name as argument name if not provided', () => {
		// Create a test class with a decorated property without explicit name
		class TestCommand extends Command {
			@Command.arg()
			testArg: string = '';

			public async run(): Promise<void> {
				// Implementation not needed for this test
			}
		}

		// Get the metadata
		const args = Reflect.getMetadata(Symbols.arg, TestCommand);

		// Check if property name was used as argument name
		expect(args).toBeArrayOfSize(1);
		expect(args[0].name).toBe('testArg');
	});

	it('should set default values correctly', async () => {
		// Create a test class with default values
		class TestCommand extends Command {
			@Command.arg({
				name: 'test-arg',
				default: 'default-value'
			})
			testArg: string = '';

			public async run(): Promise<void> {
				// Implementation not needed for this test
			}
		}

		const command = new TestCommand();
		await command.init();

		// Get the metadata
		const args = Reflect.getMetadata(Symbols.arg, TestCommand);

		// Check if default value was set correctly
		expect(args).toBeArrayOfSize(1);
		expect(args[0].default).toBe('default-value');
		expect(command.testArg).toBe('default-value');
	});
});

// Test command lifecycle
describe('Command lifecycle', () => {
	// Mock console.error to prevent actual console output
	const originalConsoleError = console.error;

	beforeEach(() => {
		console.error = mock();
	});

	afterEach(() => {
		console.error = originalConsoleError;
		mock.restore();
	});

	it('should initialize command with valid arguments', async () => {
		// Create a test command class
		class TestCommand extends Command {
			@Command.arg({
				name: 'test-arg',
				required: true
			})
			testArg: string = '';

			public async run(): Promise<void> {
				// Implementation not needed for this test
			}
		}

		// Create an instance
		const command = new TestCommand();

		// Initialize with valid arguments
		const result = await command.init('--test-arg', 'test-value');

		// Check if initialization was successful
		expect(result).toBe(true);
		expect(command.testArg).toBe('test-value');
	});

	it('should fail initialization with missing required arguments', async () => {
		// Create a test command class
		class TestCommand extends Command {
			@Command.arg({
				name: 'test-arg',
				required: true
			})
			testArg: string = '';

			public async run(): Promise<void> {
				// Implementation not needed for this test
			}
		}

		// Create an instance
		const command = new TestCommand();

		// Initialize without required arguments
		const result = await command.init();

		// Check if initialization failed
		expect(result).toBe(false);
		expect(console.error).toHaveBeenCalledWith(
			expect.stringContaining('Missing required arguments')
		);
	});

	it('should apply default values for missing arguments', async () => {
		// Create a test command class
		class TestCommand extends Command {
			@Command.arg({
				name: 'test-arg',
				default: 'default-value'
			})
			testArg: string = '';

			public async run(): Promise<void> {
				// Implementation not needed for this test
			}
		}

		// Create an instance
		const command = new TestCommand();

		// Initialize without providing the argument
		const result = await command.init();

		// Check if default value was applied
		expect(result).toBe(true);
		expect(command.testArg).toBe('default-value');
	});

	it('should return false when help argument is provided', async () => {
		// Create a test command class
		class TestCommand extends Command {
			public async run(): Promise<void> {
				// Implementation not needed for this test
			}
		}

		// Create an instance
		const command = new TestCommand();

		// Initialize with help argument
		const result = await command.init('--help');

		// Check if initialization returned false
		expect(result).toBe(false);
	});
});

// Test argument parsing and validation
describe('Argument parsing and validation', () => {
	it('should parse string arguments correctly', async () => {
		// Create a test command class
		class TestCommand extends Command {
			@Command.arg({
				name: 'string-arg',
				type: CommandArgumentType.STRING
			})
			stringArg: string = '';

			public async run(): Promise<void> {
				// Implementation not needed for this test
			}
		}

		// Create an instance
		const command = new TestCommand();

		// Initialize with string argument
		await command.init('--string-arg', 'test-value');

		// Check if argument was parsed correctly
		expect(command.stringArg).toBe('test-value');
	});

	it('should parse number arguments correctly', async () => {
		// Create a test command class
		class TestCommand extends Command {
			@Command.arg({
				name: 'number-arg',
				type: CommandArgumentType.NUMBER
			})
			numberArg: number = 0;

			public async run(): Promise<void> {
				// Implementation not needed for this test
			}
		}

		// Create an instance
		const command = new TestCommand();

		// Initialize with number argument
		await command.init('--number-arg', '42');

		// Check if argument was parsed correctly
		expect(command.numberArg).toBe(42);
	});

	it('should parse boolean arguments correctly', async () => {
		// Create a test command class
		class TestCommand extends Command {
			@Command.arg({
				name: 'bool-arg',
				type: CommandArgumentType.BOOLEAN,
				default: false
			})
			boolArg: boolean = false;

			public async run(): Promise<void> {
				// Implementation not needed for this test
			}
		}

		// Create an instance
		const command = new TestCommand();

		await command.init('--bool-arg', 'true');
		expect(command.boolArg).toBe(true);

		await command.init('--bool-arg', 'yes');
		expect(command.boolArg).toBe(true);

		await command.init('--bool-arg', '1');
		expect(command.boolArg).toBe(true);

		await command.init('--bool-arg', 'false');
		expect(command.boolArg).toBe(false);
	});

	it('should parse array arguments correctly', async () => {
		// Create a test command class
		class TestCommand extends Command {
			@Command.arg({
				name: 'array-arg',
				type: CommandArgumentType.ARRAY
			})
			arrayArg: string[] = [];

			public async run(): Promise<void> {
				// Implementation not needed for this test
			}
		}

		// Create an instance
		const command = new TestCommand();

		// Initialize with array argument
		await command.init('--array-arg', 'value1,value2,value3');

		// Check if argument was parsed correctly
		expect(command.arrayArg).toEqual(['value1', 'value2', 'value3']);
	});

	it('should parse array of numbers correctly', async () => {
		// Create a test command class
		class TestCommand extends Command {
			@Command.arg({
				name: 'number-array',
				type: CommandArgumentType.ARRAY,
				arrayType: CommandArgumentType.NUMBER
			})
			numberArray: number[] = [];

			public async run(): Promise<void> {
				// Implementation not needed for this test
			}
		}

		// Create an instance
		const command = new TestCommand();

		// Initialize with array of numbers
		await command.init('--number-array', '1,2,3');

		// Check if argument was parsed correctly
		expect(command.numberArray).toEqual([1, 2, 3]);
	});

	it('should validate enum values correctly', async () => {
		// Create a test command class
		class TestCommand extends Command {
			@Command.arg({
				name: 'enum-arg',
				type: CommandArgumentType.ENUM,
				enum: ['option1', 'option2', 'option3']
			})
			enumArg: string = '';

			public async run(): Promise<void> {
				// Implementation not needed for this test
			}
		}

		// Create an instance
		const command = new TestCommand();

		// Mock console.error
		const originalConsoleError = console.error;
		console.error = mock();

		try {
			// Initialize with valid enum value
			await command.init('--enum-arg', 'option2');

			// Check if argument was parsed correctly
			expect(command.enumArg).toBe('option2');

			// Initialize with invalid enum value
			await command.init('--enum-arg', 'invalid');

			// Check if validation error was reported
			expect(console.error).toHaveBeenCalledWith(
				expect.stringContaining('Invalid argument values')
			);
		} finally {
			console.error = originalConsoleError;
		}
	});

	it('should handle flag arguments correctly', async () => {
		// Create a test command class
		class TestCommand extends Command {
			@Command.arg({
				type: CommandArgumentType.BOOLEAN
			})
			flag: boolean = false;

			public async run(): Promise<void> {
				// Implementation not needed for this test
			}
		}

		// Create an instance
		const command = new TestCommand();

		// Initialize with flag argument (no value)
		await command.init('--flag');

		// Check if argument was parsed correctly
		expect(command['flag']).toBe(true);
	});

	it('should handle unknown argument types', async () => {
		// Create a test command class
		class TestCommand extends Command {
			@Command.arg({
				name: 'unknown-arg',
				default: 10
			})
			unknownArg: any = null;

			public async run(): Promise<void> {
				// Implementation not needed for this test
			}
		}

		// Create an instance
		const command = new TestCommand();

		// Initialize with unknown argument
		await command.init('--unknown-arg', '50');

		// Check if argument was parsed correctly
		expect(command.unknownArg).toBe(50);
	});
});

// Test help text generation
describe('Help text generation', () => {
	// Mock process.stdout.write to capture output
	const originalStdoutWrite = process.stdout.write;
	let output = '';

	beforeEach(() => {
		output = '';
		process.stdout.write = mock((message) => {
			output += message;
			return true;
		});
	});

	afterEach(() => {
		process.stdout.write = originalStdoutWrite;
	});

	it('should generate help text with command information', async () => {
		// Create a test command class
		class TestCommand extends Command {
			static readonly command = 'test-command';
			static readonly description = 'Test command description';

			public async run(): Promise<void> {
				// Implementation not needed for this test
			}
		}

		// Create an instance
		const command = new TestCommand();

		// Generate help text
		const helpText = await command.help();

		// Check if help text contains command information
		expect(helpText).toContain('test-command');
		expect(helpText).toContain('Test command description');
	});

	it('should include argument details in help text', async () => {
		// Create a test command class
		class TestCommand extends Command {
			static readonly command = 'test-command';
			static readonly description = 'Test command description';

			@Command.arg({
				name: 'string-arg',
				description: 'A string argument',
				required: true,
				type: CommandArgumentType.STRING
			})
			stringArg: string = '';

			@Command.arg({
				name: 'number-arg',
				description: 'A number argument',
				type: CommandArgumentType.NUMBER,
				default: 42
			})
			numberArg: number = 42;

			@Command.arg({
				name: 'enum-arg',
				description: 'An enum argument',
				type: CommandArgumentType.ENUM,
				enum: ['option1', 'option2', 'option3']
			})
			enumArg: string = '';

			public async run(): Promise<void> {
				// Implementation not needed for this test
			}
		}

		// Create an instance
		const command = new TestCommand();

		// Generate help text
		const helpText = await command.help();

		// Check if help text contains argument details
		expect(helpText).toContain('--string-arg');
		expect(helpText).toContain('A string argument');
		expect(helpText).toContain('(required)');

		expect(helpText).toContain('--number-arg');
		expect(helpText).toContain('A number argument');
		expect(helpText).toContain('[default: 42]');

		expect(helpText).toContain('--enum-arg');
		expect(helpText).toContain('An enum argument');
		expect(helpText).toContain('[option1|option2|option3]');
	});

	it('should handle commands with no arguments', async () => {
		// Create a test command class with no arguments
		class TestCommand extends Command {
			static readonly command = 'test-command';
			static readonly description = 'Test command description';

			public async run(): Promise<void> {
				// Implementation not needed for this test
			}
		}

		// Create an instance
		const command = new TestCommand();

		// Generate help text
		const helpText = await command.help();

		// Check if help text indicates no arguments
		expect(helpText).toContain('This command has no arguments');
	});
});

// Test UI components
describe('CommandProgressBar', () => {
	// Mock process.stdout methods
	const originalStdoutWrite = process.stdout.write;
	const originalStdoutClearLine = process.stdout.clearLine;
	const originalStdoutCursorTo = process.stdout.cursorTo;
	let output = '';

	beforeEach(() => {
		output = '';
		process.stdout.write = mock((message) => {
			output += message;
			return true;
		});
		process.stdout.clearLine = mock();
		process.stdout.cursorTo = mock();
	});

	afterEach(() => {
		process.stdout.write = originalStdoutWrite;
		process.stdout.clearLine = originalStdoutClearLine;
		process.stdout.cursorTo = originalStdoutCursorTo;
	});

	it('should create a progress bar with the correct initial state', () => {
		// Create a test command class
		class TestCommand extends Command {
			public async run(): Promise<void> {
				// Implementation not needed for this test
			}

			public createProgressBar(total: number, title: string): any {
				return this.progress(total, title);
			}
		}

		// Create an instance
		const command = new TestCommand();

		// Create a progress bar
		const progressBar = command.createProgressBar(100, 'Test Progress');

		// Check if progress bar was created with correct initial state
		expect(progressBar).toBeDefined();
		expect(progressBar.isActive()).toBe(true);
		expect(progressBar.getCurrent()).toBe(0);
		expect(progressBar.getTotal()).toBe(100);
		expect(progressBar.getPercentage()).toBe(0);

		// Check if initial render was called
		expect(process.stdout.clearLine).toHaveBeenCalled();
		expect(process.stdout.cursorTo).toHaveBeenCalled();
		expect(process.stdout.write).toHaveBeenCalled();
		expect(output).toContain('Test Progress');
	});

	it('should update progress bar correctly', () => {
		// Create a test command class
		class TestCommand extends Command {
			public async run(): Promise<void> {
				// Implementation not needed for this test
			}

			public createProgressBar(total: number, title: string): any {
				return this.progress(total, title);
			}
		}

		// Create an instance
		const command = new TestCommand();

		// Create a progress bar
		const progressBar = command.createProgressBar(100, 'Test Progress');

		// Reset mocks to clear initial render calls
		jest.clearAllMocks();
		output = '';

		// Update progress
		progressBar.update(25);

		// Check if progress was updated correctly
		expect(progressBar.getCurrent()).toBe(25);
		expect(progressBar.getPercentage()).toBe(25);

		// Check if render was called with updated progress
		expect(process.stdout.clearLine).toHaveBeenCalled();
		expect(process.stdout.cursorTo).toHaveBeenCalled();
		expect(process.stdout.write).toHaveBeenCalled();
		expect(output).toContain('Test Progress');
		expect(output).toContain('25%');
	});

	it('should complete progress bar correctly', () => {
		// Create a test command class
		class TestCommand extends Command {
			public async run(): Promise<void> {
				// Implementation not needed for this test
			}

			public createProgressBar(total: number, title: string): any {
				return this.progress(total, title);
			}
		}

		// Create an instance
		const command = new TestCommand();

		// Create a progress bar
		const progressBar = command.createProgressBar(100, 'Test Progress');

		// Reset mocks to clear initial render calls
		jest.clearAllMocks();
		output = '';

		// Complete progress
		progressBar.complete('Task completed');

		// Check if progress was completed correctly
		expect(progressBar.getCurrent()).toBe(100);
		expect(progressBar.getPercentage()).toBe(100);
		expect(progressBar.isActive()).toBe(false);

		// Check if completion message was displayed
		expect(process.stdout.clearLine).toHaveBeenCalled();
		expect(process.stdout.write).toHaveBeenCalled();
		expect(output).toContain('Task completed');
	});

	it('should pause the progress bar', () => {
		// Create a test command class
		class TestCommand extends Command {
			public async run(): Promise<void> {
				// Implementation not needed for this test
			}

			public createProgressBar(total: number, title: string) {
				return this.progress(total, title);
			}
		}

		// Create an instance
		const command = new TestCommand();

		// Create a progress bar
		const progressBar = command.createProgressBar(100, 'Test Progress');

		// Reset mocks to clear initial render calls
		jest.clearAllMocks();
		output = '';

		// Pause progress
		progressBar.pause('Task paused');

		expect(progressBar.isActive()).toBe(true);

		// Check if pause message was displayed
		expect(process.stdout.clearLine).toHaveBeenCalled();
		expect(process.stdout.write).toHaveBeenCalled();
		expect(output).toContain('Task paused');
	});
});

describe('CommandSpinner', () => {
	// Mock process.stdout methods and setInterval
	const originalStderrWrite = process.stderr.write;
	const originalStdoutWrite = process.stdout.write;
	const originalStdoutClearLine = process.stdout.clearLine;
	const originalStdoutCursorTo = process.stdout.cursorTo;
	const originalSetInterval = global.setInterval;
	const originalClearInterval = global.clearInterval;
	let output = '';

	beforeEach(() => {
		output = '';
		process.stderr.write = mock();
		process.stdout.write = mock((message) => {
			output += message;
			return true;
		});
		process.stdout.clearLine = mock();
		process.stdout.cursorTo = mock();
		global.setInterval = mock(() => 1 as any);
		global.clearInterval = mock();
	});

	afterEach(() => {
		process.stderr.write = originalStderrWrite;
		process.stdout.write = originalStdoutWrite;
		process.stdout.clearLine = originalStdoutClearLine;
		process.stdout.cursorTo = originalStdoutCursorTo;
		global.setInterval = originalSetInterval;
		global.clearInterval = originalClearInterval;
	});

	it('should create a spinner with the correct initial state', () => {
		// Create a test command class
		class TestCommand extends Command {
			public async run(): Promise<void> {
				// Implementation not needed for this test
			}

			public createSpinner(title: string): CommandSpinner {
				return this.spinner(title);
			}
		}

		// Create an instance
		const command = new TestCommand();

		// Create a spinner
		const spinner = command.createSpinner('Test Spinner');

		// Check if spinner was created with correct initial state
		expect(spinner).toBeDefined();
		expect(spinner.isActive()).toBe(true);

		// Check if animation was started
		expect(global.setInterval).toHaveBeenCalled();

		// Check if initial render was called
		expect(process.stdout.clearLine).toHaveBeenCalled();
		expect(process.stdout.cursorTo).toHaveBeenCalled();
		expect(process.stdout.write).toHaveBeenCalled();
		expect(output).toContain('Test Spinner');
	});

	it('should update spinner correctly', () => {
		// Create a test command class
		class TestCommand extends Command {
			public async run(): Promise<void> {
				// Implementation not needed for this test
			}

			public createSpinner(title: string): CommandSpinner {
				return this.spinner(title);
			}
		}

		// Create an instance
		const command = new TestCommand();

		// Create a spinner
		const spinner = command.createSpinner('Test Spinner');

		// Reset mocks to clear initial render calls
		jest.clearAllMocks();
		output = '';

		// Update spinner
		spinner.update('Updated Spinner');

		// Manually trigger render since we mocked setInterval
		// @ts-expect-error render is a private method
		spinner.render();

		// Check if spinner was updated correctly
		expect(output).toContain('Updated Spinner');
	});

	it('should complete spinner correctly', () => {
		// Create a test command class
		class TestCommand extends Command {
			public async run(): Promise<void> {
				// Implementation not needed for this test
			}

			public createSpinner(title: string): CommandSpinner {
				return this.spinner(title);
			}
		}

		// Create an instance
		const command = new TestCommand();

		// Create a spinner
		const spinner = command.createSpinner('Test Spinner');

		// Reset mocks to clear initial render calls
		jest.clearAllMocks();
		output = '';

		// Complete spinner
		spinner.complete('Task completed', true);

		// Check if spinner was completed correctly
		expect(spinner.isActive()).toBe(false);

		// Check if animation was stopped
		expect(global.clearInterval).toHaveBeenCalled();

		// Check if completion message was displayed
		expect(process.stdout.clearLine).toHaveBeenCalled();
		expect(process.stdout.write).toHaveBeenCalled();
		expect(output).toContain('Task completed');
	});

	it('should fail spinner correctly', () => {
		// Create a test command class
		class TestCommand extends Command {
			public async run(): Promise<void> {
				// Implementation not needed for this test
			}

			public createSpinner(title: string): CommandSpinner {
				return this.spinner(title);
			}
		}

		// Create an instance
		const command = new TestCommand();

		// Create a spinner
		const spinner = command.createSpinner('Test Spinner');

		jest.clearAllMocks();
		output = '';

		// Spy on complete method
		const completeSpy = spyOn(spinner, 'complete');

		// Fail spinner
		spinner.fail('Task failed');

		// Check if complete was called with correct parameters
		expect(completeSpy).toHaveBeenCalledWith('Task failed', false);
	});

	it('should pause the spinner', () => {
		// Create a test command class
		class TestCommand extends Command {
			public async run(): Promise<void> {
				// Implementation not needed for this test
			}

			public createSpinner(title: string) {
				return this.spinner(title);
			}
		}

		// Create an instance
		const command = new TestCommand();

		// Create a spinner
		const spinner = command.createSpinner('Test Spinner');

		// Reset mocks to clear initial render calls
		jest.clearAllMocks();
		output = '';

		// Pause spinner
		spinner.pause('Task paused');

		expect(spinner.isActive()).toBe(true);

		// Check if pause message was displayed
		expect(process.stdout.clearLine).toHaveBeenCalled();
		expect(process.stdout.write).toHaveBeenCalled();
		expect(output).toContain('Task paused');
	});
});

describe('@Command.register decorator', () => {
	it('should only record metadata and leave the container untouched', () => {
		const before = Container.globalNames();

		@Command.register({ name: 'meta:cmd' })
		class MetaCommand extends Command {
			public static readonly command = 'meta:original';
			public async run() {}
		}

		expect(Container.globalNames()).toEqual(before);
		expect(Reflect.getMetadata(Symbols.command, MetaCommand)).toEqual({ name: 'meta:cmd' });
	});

	it('should resolve the command name from the decorator, then from the static command', () => {
		@Command.register({ name: 'decorated' })
		class Decorated extends Command {
			public static readonly command = 'static-name';
			public async run() {}
		}

		@Command.register()
		class Plain extends Command {
			public static readonly command = 'static-name';
			public async run() {}
		}

		class Undecorated extends Command {
			public static readonly command = 'undecorated';
			public async run() {}
		}

		expect(getCommandName(Decorated)).toBe('decorated');
		expect(getCommandName(Plain)).toBe('static-name');
		expect(getCommandName(Undecorated)).toBe('undecorated');
	});

	it('should not boot the application eagerly by default', () => {
		expect(Command.boot).toBe(false);
	});
});
