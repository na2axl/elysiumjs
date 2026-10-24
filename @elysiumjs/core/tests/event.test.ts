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

import type { EventData, EventHandler } from '../src/event';

import { EventEmitter } from 'node:events';

import { afterEach, beforeEach, describe, expect, it, jest, mock, spyOn } from 'bun:test';

const emitSpy = spyOn(EventEmitter.prototype, 'emit');
const onSpy = spyOn(EventEmitter.prototype, 'on');
const onceSpy = spyOn(EventEmitter.prototype, 'once');
const prependListenerSpy = spyOn(EventEmitter.prototype, 'prependListener');
const prependOnceListenerSpy = spyOn(EventEmitter.prototype, 'prependOnceListener');
const removeAllListenersSpy = spyOn(EventEmitter.prototype, 'removeAllListeners');

const { Event, getEventListeners } = await import('../src/event');

describe('Event namespace', () => {
	beforeEach(() => {
		// Reset all mocks before each test
		jest.clearAllMocks();
	});

	afterEach(() => {
		// Clean up after each test
		Event.clear();
	});

	describe('emit', () => {
		it('should emit an event with data and source', () => {
			// Call the emit function
			const testData = { test: 'data' };
			const testSource = { source: 'test' };
			Event.emit('test-event', testData, testSource);

			// Check if emitEvent was called with the correct parameters
			expect(emitSpy).toHaveBeenCalledWith('test-event', { data: testData, source: testSource });
		});

		it('should emit an event with data and null source if not provided', () => {
			// Call the emit function without a source
			const testData = { test: 'data' };
			Event.emit('test-event', testData);

			// Check if emitEvent was called with the correct parameters
			expect(emitSpy).toHaveBeenCalledWith('test-event', { data: testData, source: null });
		});
	});

	describe('on (function)', () => {
		it('should register an event listener', () => {
			// Create a test handler
			const handler: EventHandler<any> = () => {};

			// Call the on function
			Event.on('test-event', handler);

			// Check if EventBus.on was called with the correct parameters
			expect(onSpy).toHaveBeenCalledWith('test-event', handler);
		});

		it('should handle events when emitted', () => {
			// Create a test handler with a mock
			const handler = mock();

			// Register the handler
			Event.on('test-event', handler);

			// Emit an event
			const testData = { test: 'data' };
			Event.emit('test-event', testData);

			// Check if the handler was called with the correct data
			expect(handler).toHaveBeenCalledWith({ data: testData, source: null });
		});
	});

	describe('once (function)', () => {
		it('should register a one-time event listener', () => {
			// Create a test handler
			const handler: EventHandler<any> = () => {};

			// Call the once function
			Event.once('test-event', handler);

			// Check if EventBus.once was called with the correct parameters
			expect(onceSpy).toHaveBeenCalledWith('test-event', handler);
		});

		it('should handle events only once when emitted', () => {
			// Create a test handler with a mock
			const handler = mock();

			// Register the handler with once
			Event.once('test-event', handler);

			// Emit the event twice
			const testData1 = { test: 'data1' };
			const testData2 = { test: 'data2' };
			Event.emit('test-event', testData1);
			Event.emit('test-event', testData2);

			// Check if the handler was called only once with the first data
			expect(handler).toHaveBeenCalledTimes(1);
			expect(handler).toHaveBeenCalledWith({ data: testData1, source: null });
		});
	});

	describe('off', () => {
		it('should remove all listeners for an event', () => {
			// Call the off function
			Event.off('test-event');

			// Check if removeAllListeners was called with the correct parameters
			expect(removeAllListenersSpy).toHaveBeenCalledWith('test-event');
		});
	});

	describe('on (decorator)', () => {
		it('only records the listener as class metadata', () => {
			class TestClass {
				@Event.on({ event: 'test-event', prepend: true })
				handleEvent(_eventData: EventData<any>) {}

				@Event.on({ event: 'test-static' })
				static handleStatic(_eventData: EventData<any>) {}
			}

			expect(onSpy).not.toHaveBeenCalledWith('test-event', expect.any(Function));
			expect(prependListenerSpy).not.toHaveBeenCalled();
			expect(getEventListeners(TestClass)).toEqual([
				{ event: 'test-event', method: 'handleEvent', mode: 'on', prepend: true, static: false },
				{ event: 'test-static', method: 'handleStatic', mode: 'on', prepend: false, static: true }
			]);
		});
	});

	describe('once (decorator)', () => {
		it('only records the listener as class metadata', () => {
			class TestClass {
				@Event.once({ event: 'test-event' })
				handleEvent(_eventData: EventData<any>) {}
			}

			expect(onceSpy).not.toHaveBeenCalledWith('test-event', expect.any(Function));
			expect(getEventListeners(TestClass)).toEqual([
				{ event: 'test-event', method: 'handleEvent', mode: 'once', prepend: false, static: false }
			]);
		});
	});
});
