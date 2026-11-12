// Copyright (c) 2025-present Axel Nana <ax.lnana@outlook.com>. All rights reserved.
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

/**
 * The surface of a Redis client that the Elysium packages rely on. Any Redis client can be
 * plugged in by adapting it to this interface; everything else goes through {@link send}.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export interface RedisConnection {
	/** Whether the connection is currently established. */
	readonly connected: boolean;

	/** Called when the connection is established. */
	onconnect?: () => void;

	/** Called when the connection is closed. */
	onclose?: (error: unknown) => void;

	/**
	 * Sends a raw command.
	 * @param command The command name, e.g. `ZADD`.
	 * @param args The arguments of the command.
	 */
	send(command: string, args: string[]): Promise<unknown>;

	/** Gets the value of a key, or `null` if it does not exist. */
	get(key: string): Promise<string | null>;

	/** Sets the value of a key. Use `send('SET', [...])` for options such as `PX` or `NX`. */
	set(key: string, value: string): Promise<unknown>;

	/** Deletes keys, resolving to the number of keys deleted. */
	del(...keys: string[]): Promise<number>;

	/** Sets the time to live of a key, resolving to `1` if it was set. */
	expire(key: string, seconds: number): Promise<number>;

	/** Subscribes to a pub/sub channel. */
	subscribe(
		channel: string,
		listener: (message: string, channel: string) => void
	): Promise<unknown>;

	/** Unsubscribes from a channel, or from all channels when none is given. */
	unsubscribe(channel?: string): Promise<unknown>;

	/** Creates a new, unconnected connection with the same configuration. */
	duplicate(): Promise<RedisConnection>;

	/** Establishes the connection. */
	connect(): Promise<void>;

	/** Closes the connection. */
	close(): Promise<void> | void;
}

/**
 * Creates the connection to a Redis server.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type RedisClientFactory = (url: string, options: Record<string, unknown>) => RedisConnection;
