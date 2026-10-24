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

import 'reflect-metadata';

import type { SingletonBase } from 'elysia';

export { type Elysia, type TSchema, type Static, t } from 'elysia';
export { type AppContext, type ElysiumPlugin, Application } from './app';
export {
	type CommandArgumentProps,
	type CommandClass,
	Command,
	CommandArgumentType
} from './command';
export { ConsoleFormat, InteractsWithConsole } from './console';
export { Env } from './env';
export { type EventData, type EventHandler, Event } from './event';
export { type LoggerInterface, ConsoleLogger } from './logger';
export { type Context, type Route, HttpControllerScope, Http } from './http';
export { Middleware } from './middleware';
export { RequestLoggerMiddleware } from './middlewares/request-logger.middleware';
export {
	ConflictingModuleConfigError,
	DuplicateCommandError,
	DuplicateGlobalServiceError,
	ElysiumError,
	EnvironmentSkippedModuleError,
	InvalidModuleError,
	InvalidModuleConfigError,
	MissingModuleConfigError,
	ModuleCycleError,
	ServiceNotFoundError,
	ServiceNotReadyError,
	ServiceNotVisibleError
} from './errors';
export { needsDefaultAlias, runAll } from './connections';
export { Kernel } from './kernel';
export { type ConfiguredModule, type ModuleClass, type ModuleProps, Module } from './module';
export { ModuleContext } from './module-context';
export { type ModuleGraph, type ModuleNode } from './module-graph';
export { type TestingApp, type TestingOptions } from './testing';
export { type RedisConnectionProps, type RedisModuleConfig, Redis, RedisModule } from './redis';
export {
	type ServiceDefinition,
	type ServiceFactoryDefinition,
	ServiceScope,
	Service
} from './service';
export {
	type WampRegistrationOptions,
	type WampSubscriptionOptions,
	type WampProps,
	type WampRegistrationHandlerArgs,
	type WampSubscriptionHandlerArgs,
	type WampRegistrationHandler,
	type WampSubscriptionHandler,
	type WampClientProps,
	type WampModuleConfig,
	Wamp,
	WampModule
} from './wamp';
export { type WS, type WSError, Websocket } from './websocket';

/**
 * The type for the context of the application.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export interface AppHttpContext extends SingletonBase {}

/**
 * The type for all registered environment variables.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export interface AppEnv {
	[key: string]: string;
}
