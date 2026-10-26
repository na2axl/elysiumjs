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

import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';

import { ConsoleFormat, InteractsWithConsole } from '../src/console';

describe('InteractsWithConsole', () => {
	// Mock process.stdout and process.stderr
	const originalStdoutWrite = process.stdout.write;
	const originalStderrWrite = process.stderr.write;
	const originalStdoutClearLine = process.stdout.clearLine;
	const originalStdoutCursorTo = process.stdout.cursorTo;
	const originalStdoutMoveCursor = process.stdout.moveCursor;
	let stdoutOutput = '';
	let stderrOutput = '';

	beforeEach(() => {
		stdoutOutput = '';
		stderrOutput = '';
		process.stdout.write = mock((message) => {
			stdoutOutput += message;
			return true;
		});
		process.stderr.write = mock((message) => {
			stderrOutput += message;
			return true;
		});
		process.stdout.clearLine = mock();
		process.stdout.cursorTo = mock();
		process.stdout.moveCursor = mock();
	});

	afterEach(() => {
		process.stdout.write = originalStdoutWrite;
		process.stderr.write = originalStderrWrite;
		process.stdout.clearLine = originalStdoutClearLine;
		process.stdout.cursorTo = originalStdoutCursorTo;
		process.stdout.moveCursor = originalStdoutMoveCursor;
	});

	// Test basic output methods
	describe('Basic output methods', () => {
		it('should write message to stdout', () => {
			const console = new InteractsWithConsole();
			console.write('Test message');
			expect(stdoutOutput).toBe('Test message\n');
		});

		it('should write message without newline when specified', () => {
			const console = new InteractsWithConsole();
			console.write('Test message', false);
			expect(stdoutOutput).toBe('Test message');
		});

		it('should write to specified output stream', () => {
			const console = new InteractsWithConsole();
			console.write('Error message', true, process.stderr);
			expect(stderrOutput).toBe('Error message\n');
			expect(stdoutOutput).toBe('');
		});

		it('should write a newline', () => {
			const console = new InteractsWithConsole();
			console.newLine();
			expect(stdoutOutput).toBe('\n');
		});
	});

	// Test formatted output methods
	describe('Formatted output methods', () => {
		it('should write info message', () => {
			const console = new InteractsWithConsole();
			console.info('Info message');
			expect(stdoutOutput).toMatch(/ℹ\S* Info message/);
		});

		it('should write success message', () => {
			const console = new InteractsWithConsole();
			console.success('Success message');
			expect(stdoutOutput).toMatch(/✔\S* Success message/);
		});

		it('should write warning message', () => {
			const console = new InteractsWithConsole();
			console.warning('Warning message');
			expect(stdoutOutput).toMatch(/⚠\S* Warning message/);
		});

		it('should write error message to stderr', () => {
			const console = new InteractsWithConsole();
			console.error('Error message');
			expect(stderrOutput).toMatch(/✖\S* Error message/);
		});

		it('should write debug message when DEBUG is set', () => {
			const originalDebug = process.env.DEBUG;
			process.env.DEBUG = 'true';

			const console = new InteractsWithConsole();
			console.debug('Debug message');
			expect(stdoutOutput).toContain('🔍 Debug message');

			process.env.DEBUG = originalDebug;
		});

		it('should not write debug message when DEBUG is not set', () => {
			const originalDebug = process.env.DEBUG;
			process.env.DEBUG = '';

			const console = new InteractsWithConsole();
			console.debug('Debug message');
			expect(stdoutOutput).toBe('');

			process.env.DEBUG = originalDebug;
		});
	});

	// Test text formatting methods
	describe('Text formatting methods', () => {
		it('should format text with a single style', () => {
			const console = new InteractsWithConsole();
			const formatted = console.format('Test', ConsoleFormat.RED);

			// Check that the formatted text contains ANSI codes and the original text
			expect(formatted).toContain('Test');
			expect(formatted).toContain('\x1b['); // ANSI escape code start
			expect(formatted).toContain('\x1b[0m'); // ANSI reset code
		});

		it('should format text with multiple styles', () => {
			const console = new InteractsWithConsole();
			const formatted = console.format('Test', ConsoleFormat.RED, ConsoleFormat.BOLD);

			// Check that the formatted text contains ANSI codes and the original text
			expect(formatted).toContain('Test');
			expect(formatted).toContain('\x1b['); // ANSI escape code start
			expect(formatted).toContain('\x1b[0m'); // ANSI reset code
		});

		it('should format text as bold', () => {
			const console = new InteractsWithConsole();
			const formatted = console.bold('Bold text');

			// Check that the formatted text contains ANSI codes and the original text
			expect(formatted).toContain('Bold text');
			expect(formatted).toContain('\x1b[1m'); // Bold ANSI code
			expect(formatted).toContain('\x1b[0m'); // ANSI reset code
		});

		it('should format text as italic', () => {
			const console = new InteractsWithConsole();
			const formatted = console.italic('Italic text');

			// Check that the formatted text contains ANSI codes and the original text
			expect(formatted).toContain('Italic text');
			expect(formatted).toContain('\x1b[3m'); // Italic ANSI code
			expect(formatted).toContain('\x1b[0m'); // ANSI reset code
		});

		it('should format text as underline', () => {
			const console = new InteractsWithConsole();
			const formatted = console.underline('Underlined text');

			// Check that the formatted text contains ANSI codes and the original text
			expect(formatted).toContain('Underlined text');
			expect(formatted).toContain('\x1b[4m'); // Underline ANSI code
			expect(formatted).toContain('\x1b[0m'); // ANSI reset code
		});
	});

	// Test section and title methods
	describe('Section and title methods', () => {
		it('should format and write a title', () => {
			const console = new InteractsWithConsole();
			console.title('Test Title');

			// Check that the output contains the title with formatting
			expect(stdoutOutput).toContain('Test Title');
			expect(stdoutOutput.split('\n').length).toBeGreaterThan(2); // Should have newlines before and after
		});

		it('should format and write a section header', () => {
			const console = new InteractsWithConsole();
			console.section('Test Section');

			// Check that the output contains the section header with formatting
			expect(stdoutOutput).toContain('Test Section');
			expect(stdoutOutput).toContain('\x1b[1m'); // Bold ANSI code
			expect(stdoutOutput).toContain('\x1b[0m'); // ANSI reset code
		});
	});

	// Test error tracing
	describe('Error tracing', () => {
		it('should trace an error with name, message, and stack', () => {
			const console = new InteractsWithConsole();
			const error = new Error('Test error');
			error.name = 'TestError';

			console.trace(error);

			// Check that the output contains error details
			expect(stdoutOutput).toContain('TestError: Test error');
			expect(stdoutOutput).toContain('Stack Trace:');
		});

		it('should trace an error with custom properties', () => {
			const console = new InteractsWithConsole();
			const error = new Error('Test error');
			(error as any).customProp = 'Custom value';

			console.trace(error);

			// Check that the output contains custom properties
			expect(stdoutOutput).toContain('Test error');
			expect(stdoutOutput).toContain('Stack Trace:');
			expect(stdoutOutput).toContain('customProp');
			expect(stdoutOutput).toContain('Custom value');
		});

		it('should handle errors without stack traces', () => {
			const console = new InteractsWithConsole();
			const error = { name: 'TestError', message: 'Test error' };

			console.trace(error as Error);

			// Check that the output contains error details
			expect(stdoutOutput).toContain('TestError: Test error');
			expect(stdoutOutput).not.toContain('Stack Trace:');
		});
	});

	// Test cursor control methods
	describe('Cursor control methods', () => {
		it('should clear the console', () => {
			const console = new InteractsWithConsole();
			console.clear();

			// Check that the output contains the clear screen escape code
			expect(stdoutOutput).toContain('\x1Bc');
		});

		it('should move the cursor to a specific position', () => {
			const console = new InteractsWithConsole();
			console.moveCursor(10, 20);

			// Check that cursorTo was called with the correct coordinates
			expect(process.stdout.moveCursor).toHaveBeenCalledWith(10, 20);
		});

		it('should clear the current line', () => {
			const console = new InteractsWithConsole();
			console.clearLine();

			// Check that clearLine and cursorTo were called
			expect(process.stdout.clearLine).toHaveBeenCalledWith(0);
			expect(process.stdout.cursorTo).toHaveBeenCalledWith(0);
		});
	});

	// Test table generation
	describe('Table generation', () => {
		it('should generate a table with headers and data', () => {
			const console = new InteractsWithConsole();
			const data = [
				{ name: 'John', age: 30, city: 'New York' },
				{ name: 'Jane', age: 25, city: 'Los Angeles' }
			];

			console.table(data);

			// Check that the output contains table headers and data
			expect(stdoutOutput).toContain('name');
			expect(stdoutOutput).toContain('age');
			expect(stdoutOutput).toContain('city');
			expect(stdoutOutput).toContain('John');
			expect(stdoutOutput).toContain('30');
			expect(stdoutOutput).toContain('New York');
			expect(stdoutOutput).toContain('Jane');
			expect(stdoutOutput).toContain('25');
			expect(stdoutOutput).toContain('Los Angeles');
		});

		it('should generate a table with custom column configuration', () => {
			const console = new InteractsWithConsole();
			const data = [
				{ name: 'John', age: 30, city: 'New York' },
				{ name: 'Jane', age: 25, city: 'Los Angeles' }
			];

			console.table(data, {
				name: { header: 'Full Name', width: 20 },
				age: { header: 'Years', format: (value) => `${value} years` }
			});

			// Check that the output contains custom headers and formatted data
			expect(stdoutOutput).toContain('Full Name');
			expect(stdoutOutput).toContain('Years');
			expect(stdoutOutput).toContain('30 years');
			expect(stdoutOutput).toContain('25 years');
		});

		it('should handle empty data arrays', () => {
			const console = new InteractsWithConsole();
			console.table([]);

			// Check that the output contains a message about no data
			expect(stdoutOutput).toContain('No data to display');
		});
	});

	// Test utility methods
	describe('Utility methods', () => {
		it('should format time in seconds correctly', () => {
			const console = new InteractsWithConsole();

			// Test different time ranges
			expect(console['formatTime'](30)).toBe('30.0s');
			expect(console['formatTime'](90)).toBe('1m 30s');
			expect(console['formatTime'](3661)).toBe('1h 1m');
		});
	});

	// Test user input methods (these are harder to test and may require more complex mocking)
	describe('User input methods', () => {
		it('should prompt for user input', async () => {
			// Mock readline interface
			const mockQuestion = mock((_question, callback) => {
				callback('test input');
			});

			const mockReadline = {
				question: mockQuestion,
				close: mock()
			};

			mock.module('node:readline', () => ({
				createInterface: mock(() => mockReadline)
			}));

			try {
				const console = new InteractsWithConsole();
				const result = await console['prompt']('Enter value');

				expect(mockQuestion).toHaveBeenCalled();
				expect(mockReadline.close).toHaveBeenCalled();
				expect(result).toBe('test input');
			} finally {
				mock.restore();
			}
		});

		it('should use default value when prompt input is empty', async () => {
			// Mock readline interface
			const mockQuestion = mock((_question, callback) => {
				callback('');
			});

			const mockReadline = {
				question: mockQuestion,
				close: mock()
			};

			mock.module('node:readline', () => ({
				createInterface: mock(() => mockReadline)
			}));

			try {
				const console = new InteractsWithConsole();
				const result = await console['prompt']('Enter value', 'default');

				expect(mockQuestion).toHaveBeenCalled();
				expect(mockReadline.close).toHaveBeenCalled();
				expect(result).toBe('default');
			} finally {
				mock.restore();
			}
		});

		it('should prompt for password and mask input', async () => {
			// Mock process.stdin
			const originalStdinOn = process.stdin.on;
			const originalStdinRemoveAllListeners = process.stdin.removeAllListeners;
			const originalStdinSetRawMode = process.stdin.setRawMode;

			process.stdin.on = mock((event, callback) => {
				if (event === 'data') {
					// Simulate typing "password" and then Enter
					callback(Buffer.from('p'));
					callback(Buffer.from('a'));
					callback(Buffer.from('s'));
					callback(Buffer.from('s'));
					callback(Buffer.from('\r')); // Enter key
				}
				return process.stdin;
			});

			process.stdin.removeAllListeners = mock();
			process.stdin.setRawMode = mock();

			// Mock readline interface
			const mockReadline = {
				close: mock()
			};

			mock.module('node:readline', () => ({
				createInterface: mock(() => mockReadline)
			}));

			try {
				const console = new InteractsWithConsole();
				const result = await console['promptPassword']('Enter password');

				expect(process.stdin.on).toHaveBeenCalledWith('data', expect.any(Function));
				expect(process.stdin.setRawMode).toHaveBeenCalledWith(true);
				expect(process.stdin.removeAllListeners).toHaveBeenCalledWith('data');
				expect(mockReadline.close).toHaveBeenCalled();
				expect(result).toBe('pass');
			} finally {
				process.stdin.on = originalStdinOn;
				process.stdin.removeAllListeners = originalStdinRemoveAllListeners;
				process.stdin.setRawMode = originalStdinSetRawMode;
				mock.restore();
			}
		});

		it('should handle confirm with yes response', async () => {
			// Mock prompt method
			const console = new InteractsWithConsole();
			const promptSpy = spyOn(console, 'prompt' as any).mockResolvedValue('y');

			const result = await console['confirm']('Confirm?');

			expect(promptSpy).toHaveBeenCalledWith('Confirm? [y/N]');
			expect(result).toBe(true);
		});

		it('should handle confirm with no response', async () => {
			// Mock prompt method
			const console = new InteractsWithConsole();
			const promptSpy = spyOn(console, 'prompt' as any).mockResolvedValue('n');

			const result = await console['confirm']('Confirm?');

			expect(promptSpy).toHaveBeenCalledWith('Confirm? [y/N]');
			expect(result).toBe(false);
		});

		it('should handle confirm with default value when no input', async () => {
			// Mock prompt method
			const console = new InteractsWithConsole();
			const promptSpy = spyOn(console, 'prompt' as any).mockResolvedValue('');

			// Test with default true
			let result = await console['confirm']('Confirm?', true);
			expect(promptSpy).toHaveBeenCalledWith('Confirm? [Y/n]');
			expect(result).toBe(true);

			// Test with default false
			promptSpy.mockResolvedValue('');
			result = await console['confirm']('Confirm?', false);
			expect(promptSpy).toHaveBeenCalledWith('Confirm? [y/N]');
			expect(result).toBe(false);
		});

		it('should handle select with valid option', async () => {
			// Mock prompt method
			const console = new InteractsWithConsole();
			const promptSpy = spyOn(console, 'prompt' as any).mockResolvedValue('2');
			const writeSpy = spyOn(console, 'write');

			const options = ['Option 1', 'Option 2', 'Option 3'];
			const result = await console['select']('Select an option:', options, 1);

			expect(writeSpy).toHaveBeenCalledWith('Select an option:');
			expect(writeSpy).toHaveBeenCalledWith('  1. Option 1');
			expect(writeSpy).toHaveBeenCalledWith('  2. Option 2 (default)');
			expect(writeSpy).toHaveBeenCalledWith('  3. Option 3');
			expect(promptSpy).toHaveBeenCalledWith('Enter your choice (number)');
			expect(result).toBe('Option 2');
		});

		it('should handle select with invalid option', async () => {
			// Mock prompt method
			const console = new InteractsWithConsole();
			const promptSpy = spyOn(console, 'prompt' as any).mockResolvedValue('99');
			const warningSpy = spyOn(console, 'warning');

			const options = ['Option 1', 'Option 2', 'Option 3'];
			const result = await console['select']('Select an option:', options);

			expect(promptSpy).toHaveBeenCalledWith('Enter your choice (number)');
			expect(warningSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid selection'));
			expect(result).toBe('Option 1'); // Default is first option
		});

		it('should handle select with empty input', async () => {
			// Mock prompt method
			const console = new InteractsWithConsole();
			const promptSpy = spyOn(console, 'prompt' as any).mockResolvedValue('');

			const options = ['Option 1', 'Option 2', 'Option 3'];
			const result = await console['select']('Select an option:', options, 1);

			expect(promptSpy).toHaveBeenCalledWith('Enter your choice (number)');
			expect(result).toBe('Option 2'); // Default is second option (index 1)
		});

		it('should throw error when select has no options', async () => {
			const console = new InteractsWithConsole();

			await expect(console['select']('Select an option:', [])).rejects.toThrow(
				'No options provided'
			);
		});
	});
});
