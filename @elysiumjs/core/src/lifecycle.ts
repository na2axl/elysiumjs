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

import { EventEmitter } from 'node:events';

import { ElysiumError } from './errors';
import { Metadata } from './metadata';
import { Symbols } from './utils';

/**
 * Internal event bus used by the framework.
 * @internal
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class LifecycleBus extends EventEmitter {
	static readonly instance = new LifecycleBus();

	private constructor() {
		super();

		this.on('error', (error) => this.emitError(error));
	}

	public emitError(error: unknown) {
		this.emit('elysium:error', { data: error, source: null });
	}

	public emitEvent(event: string, data: unknown, source: unknown = null) {
		this.emit(event, { data, source });
	}
}

/**
 * Stores the event data with the source.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type LifecycleEvent<TData, TSource = null> = {
	/**
	 * The emitted data.
	 */
	data: TData;

	/**
	 * The source of the event.
	 */
	source: TSource | null;
};

/**
 * Lifecycle handler function.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type LifecycleHandler<TData, TSource = any> = (
	event: LifecycleEvent<TData, TSource>
) => void | Promise<void>;

/**
 * Properties required when declaring a method as an event listener.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type ListenProps = {
	/**
	 * The listener mode.
	 *
	 * Set it to `on` to listen for the event every time it is emitted.
	 * Set it to `once` to listen for the event only once.
	 */
	mode: 'on' | 'once';

	/**
	 * The event name.
	 */
	event: string;

	/**
	 * Whether to prepend the listener to the event. Defaults to `false`.
	 * @default false
	 */
	prepend?: boolean;
};

/**
 * A listener recorded on a class by `@Lifecycle.on` / `@Lifecycle.once`.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type LifecycleListenerMeta = {
	readonly event: string;
	readonly method: string | symbol;
	readonly mode: 'on' | 'once';
	readonly prepend: boolean;
	readonly static: boolean;
};

/**
 * Gets the listeners recorded on a class by the `@Lifecycle.on` / `@Lifecycle.once` decorators.
 * @author Axel Nana <axel.nana@workbud.com>
 * @param cls The class to inspect.
 */
export function getLifecycleListeners(cls: object): readonly LifecycleListenerMeta[] {
	return Metadata.getOwn(Symbols.lifecycleListeners, cls) ?? [];
}

const recordListener = (
	target: object,
	method: string | symbol,
	mode: 'on' | 'once',
	props: Omit<ListenProps, 'mode'>
): void => {
	const isStatic = typeof target === 'function';
	const owner = isStatic ? target : target.constructor;
	Metadata.define(
		Symbols.lifecycleListeners,
		[
			...getLifecycleListeners(owner),
			{ event: props.event, method, mode, prepend: props.prepend ?? false, static: isStatic }
		],
		owner
	);
};

export namespace Lifecycle {
	/**
	 * Emits an event with the provided data and source.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param event The event name.
	 * @param data The emitted data.
	 * @param source The source of the event. Defaults to `null`.
	 */
	export const emit = <TData, TSource = any>(
		event: string,
		data: TData,
		source: TSource | null = null
	): void => {
		LifecycleBus.instance.emitEvent(event, data, source);
	};

	/**
	 * Marks a method as an event listener. The decorator only records the listener on the class.
	 * The kernel registers it when the module that lists the class in its `services` or
	 * `controllers` initialises, and runs it in that module's context, so it sees the module's
	 * private services. Listeners on classes that no loaded module lists never fire, and a lazy
	 * CLI boot only wires the modules it prepares (eager boot wires every module).
	 *
	 * Static methods are called on the class. Instance methods require a class registered as a
	 * service: they run on the instance the container resolves.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param event The event name.
	 * @param options Whether the listener goes first (`prepend`).
	 * @example
	 * ```ts
	 * @Lifecycle.on('elysium:error')
	 * public static report(e: LifecycleEvent<Error>) {}
	 * ```
	 */
	export function on(event: string, options?: Omit<ListenProps, 'mode' | 'event'>): MethodDecorator;

	/**
	 * Registers an event listener for the specified event.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param event The event name.
	 * @param handler The event handler function.
	 */
	export function on<TData, TSource = any>(
		event: string,
		handler: LifecycleHandler<TData, TSource>
	): void;

	export function on<TData, TSource = any>(
		event: string,
		handler?: LifecycleHandler<TData, TSource> | Omit<ListenProps, 'mode' | 'event'>
	): MethodDecorator | void {
		if (typeof handler === 'function') {
			LifecycleBus.instance.on(event, handler);
			return;
		}
		return function (target, propertyKey) {
			recordListener(target, propertyKey, 'on', { ...handler, event });
		};
	}

	/**
	 * Marks a method as an event listener that listens for the event only once.
	 * Like {@link Lifecycle.on}, the decorator is metadata-only and the kernel wires it per module.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param event The event name.
	 * @param options Whether the listener goes first (`prepend`).
	 */
	export function once(
		event: string,
		options?: Omit<ListenProps, 'mode' | 'event'>
	): MethodDecorator;

	/**
	 * Registers an event listener for the specified event that listens for the event only once.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param event The event name.
	 * @param handler The event handler function.
	 */
	export function once<TData, TSource = any>(
		event: string,
		handler: LifecycleHandler<TData, TSource>
	): void;

	export function once<TData, TSource = any>(
		event: string,
		handler?: LifecycleHandler<TData, TSource> | Omit<ListenProps, 'mode' | 'event'>
	): MethodDecorator | void {
		if (typeof handler === 'function') {
			LifecycleBus.instance.once(event, handler);
			return;
		}
		return function (target, propertyKey) {
			recordListener(target, propertyKey, 'once', { ...handler, event });
		};
	}

	/**
	 * Removes all event listeners for the specified event.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param event The event name.
	 */
	export const off = (event: string): void => {
		LifecycleBus.instance.removeAllListeners(event);
	};

	/**
	 * Removes all event listeners.
	 * @author Axel Nana <axel.nana@workbud.com>
	 */
	export const clear = () => {
		LifecycleBus.instance.removeAllListeners();
	};

	/**
	 * Marks a method as an event listener.
	 * @param options The decorator options.
	 * @throws {ElysiumError} If `options.mode` is neither `on` nor `once`.
	 */
	export const listen = ({ mode, event, ...options }: ListenProps): MethodDecorator => {
		if (mode === 'on') {
			return on(event, options);
		} else if (mode === 'once') {
			return once(event, options);
		}

		throw new ElysiumError("Unknown mode provided to @listen. Use either 'on' or 'once'.");
	};
}
