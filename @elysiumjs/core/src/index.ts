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

export { type Elysia, t } from 'elysia';
export { type Static, type TObject, type TSchema } from 'typebox';
export { type AppContext, type ElysiumPlugin, type ServerError, Application } from './app';
export {
	type CommandArgumentProps,
	type CommandClass,
	Command,
	CommandArgumentType
} from './command';
export {
	ConsoleFormat,
	type ConsoleTag,
	type ConsoleTagStyle,
	InteractsWithConsole
} from './console';
export { Env } from './env';
export { type EventData, type EventHandler, Event } from './event';
export { type LoggerInterface, ConsoleLogger, getLogger, LOGGER_SERVICE } from './logger';
export {
	type Context,
	type HttpControllerDescription,
	type HttpControllerProps,
	type HttpRouteDescription,
	type RequestHandlerDecoratorProps,
	type Route,
	DATABASE_TRANSACTION_SERVICE,
	HttpControllerScope,
	Http
} from './http';
export { Metadata } from './metadata';
export { currentUserId, userIdOf } from './user';
export { Middleware } from './middleware';
export { RequestLoggerMiddleware } from './middlewares/request-logger.middleware';
export {
	CircularDependencyError,
	ConflictingModuleConfigError,
	DuplicateCommandError,
	DuplicateGlobalServiceError,
	DuplicateModuleNameError,
	ElysiumError,
	EnvironmentSkippedModuleError,
	EventListenerNotSupportedError,
	InvalidModuleError,
	InvalidModuleConfigError,
	MissingModuleConfigError,
	ModuleCycleError,
	OutsideRequestScopeError,
	ScopeMismatchError,
	InterceptorNextCalledTwiceError,
	ServiceNotFoundError,
	ServiceNotReadyError,
	ServiceNotVisibleError
} from './errors';
export { needsDefaultAlias, runAll } from './connections';
export { Kernel, KERNEL_SERVICE } from './kernel';
export { type ConfiguredModule, type ModuleClass, type ModuleProps, Module } from './module';
export { ModuleContext } from './module-context';
export { type ModuleGraph, type ModuleNode } from './module-graph';
export {
	type TestingApp,
	type TestingAppOptions,
	type TestingHttpApp,
	type TestingOptions,
	resetContainer
} from './testing';
export {
	type HttpTestClient,
	type RequestHandler,
	type TestResponse,
	createHttpClient,
	TestRequest,
	UnexpectedStatusError
} from './http-client';
export {
	type OutputLevel,
	type ServeHandle,
	type ShutdownSignal,
	Runtime,
	RuntimeNotConfiguredError,
	RuntimeNotSupportedError
} from './runtime';
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
export interface AppHttpContext {
	decorator: Record<string, unknown>;
	store: Record<string, unknown>;
	derive: Record<string, unknown>;
}

/**
 * The type for all registered environment variables.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export interface AppEnv {
	[key: string]: string;
}
export {
	type DomainErrorProps,
	type ProblemContext,
	type ProblemDetails,
	type ProblemOptions,
	type ProblemValidationError,
	DomainError,
	isProblemDetails,
	PROBLEM_CONTENT_TYPE,
	ProblemDetailsSchema,
	problemResponse,
	statusTitle,
	toProblem,
	validationErrors
} from './problem';
export { type ExceptionFilter, type FilterClass, type FilterContext, Catch } from './filter';
export { type ResponseSchemas, Resource } from './resource';
export {
	type AppRateLimitOptions,
	type RateLimitHit,
	type RateLimitKeyContext,
	type RateLimitOptions,
	type RateLimitStore,
	MemoryRateLimitStore,
	RateLimit,
	TooManyRequestsError
} from './rate-limit';
export {
	type Interceptor,
	type InterceptorClass,
	type InterceptorContext,
	TimingInterceptor,
	TransformInterceptor
} from './interceptor';
export {
	type EnvironmentIssue,
	ConflictingEnvironmentSchemaError,
	InvalidEnvironmentError,
	mergeEnvironmentSchemas,
	Secret,
	validateEnvironment
} from './config';
export {
	type CorsOptions,
	type HttpOptions,
	type SecurityHeadersOptions,
	clientAddress,
	DEFAULT_BODY_LIMIT,
	InvalidCorsOptionsError,
	PayloadTooLargeError
} from './security';
