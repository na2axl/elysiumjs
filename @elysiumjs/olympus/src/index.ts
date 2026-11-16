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

export { type Elysia, t } from 'elysia';
export { type Static, type TObject, type TOptional, type TSchema, type TString } from 'typebox';
export { type AppContext, type ElysiumPlugin, type ServerError, Application } from './app.js';
export {
	type CommandArgumentProps,
	type CommandClass,
	Command,
	CommandArgumentType
} from './command.js';
export {
	ConsoleFormat,
	type ConsoleTag,
	type ConsoleTagStyle,
	InteractsWithConsole
} from './console.js';
export { type AppEnv, type EnvName, type EnvValue, Env, EnvironmentNotReadyError } from './env.js';
export { type BackgroundScope, type BackgroundWork, Background } from './background.js';
export { type LifecycleEvent, type LifecycleHandler, Lifecycle } from './lifecycle.js';
export {
	type LoggerInterface,
	type LoggerOptions,
	type LogLevel,
	ConsoleLogger,
	getLogger,
	Logger,
	LOGGER_SERVICE
} from './logger.js';
export {
	type Context,
	type HttpBodyParser,
	type HttpControllerDescription,
	type HttpControllerOptions,
	type HttpControllerProps,
	type HttpRouteDescription,
	type HttpRouteOptions,
	type HttpRouteTypeRef,
	type HttpRouteTypes,
	type HttpRouteTypesContributor,
	type RequestHandlerDecoratorProps,
	type Route,
	DATABASE_TRANSACTION_SERVICE,
	HttpControllerScope,
	Http
} from './http.js';
export { Metadata } from './metadata.js';
export { currentUserId, userIdOf } from './user.js';
export { currentEnvironment } from './utils.js';
export { Clock, ClockAdjustmentRefusedError, SystemClock } from './clock.js';
export {
	type LockAcquireOptions,
	type LockHandle,
	type LockRun,
	Lock,
	LockDriver,
	MemoryLock
} from './lock.js';
export {
	type PortClass,
	type PortDriver,
	type PortDriverClass,
	type PortDriverName,
	type PortDriverOptions,
	type PortDrivers,
	type PortDriverType,
	type Ports,
	DuplicatePortDriverError,
	Port,
	UnknownPortDriverError
} from './port.js';
export { AsyncResult, Failed, Passed, Result } from './result.js';
export type { ClockSource } from './clock.js';
export { Environments } from './environments.js';
export type { Environment } from './environments.js';
export { Middleware } from './middleware.js';
export { RequestLoggerMiddleware } from './middlewares/request-logger.middleware.js';
export {
	CircularDependencyError,
	ConflictingModuleConfigError,
	DuplicateCommandError,
	DuplicateExtensionError,
	DuplicateGlobalServiceError,
	DuplicateModuleNameError,
	ElysiumError,
	EnvironmentSkippedModuleError,
	EnvironmentSkippedServiceError,
	LifecycleListenerNotSupportedError,
	InvalidModuleError,
	InvalidModuleConfigError,
	MissingModuleConfigError,
	ModuleCycleError,
	NotAnExtensionError,
	OutsideRequestScopeError,
	ScopeMismatchError,
	InterceptorNextCalledTwiceError,
	ServiceNotFoundError,
	ServiceNotReadyError,
	ServiceNotVisibleError
} from './errors.js';
export { needsDefaultAlias, runAll } from './connections.js';
export { Kernel, KERNEL_SERVICE } from './kernel.js';
export {
	type ConfiguredModule,
	type ModuleClass,
	type ModuleCollections,
	type ModuleProps,
	Module
} from './module.js';
export { ModuleContext } from './module-context.js';
export { type ModuleGraph, type ModuleNode } from './module-graph.js';
export {
	type TestingApp,
	type TestingAppOptions,
	type TestingHttpApp,
	type TestingOptions,
	resetContainer
} from './testing.js';
export {
	type HttpTestClient,
	type RequestHandler,
	type TestResponse,
	createHttpClient,
	TestRequest,
	UnexpectedStatusError
} from './http-client.js';
export {
	type OutputLevel,
	type ServeHandle,
	type ShutdownSignal,
	Runtime,
	RuntimeNotConfiguredError,
	RuntimeNotSupportedError
} from './runtime.js';
export {
	type Extension,
	type ExtensionOptions,
	type ExtensionSettings,
	type ServiceDefinition,
	type ServiceFactoryDefinition,
	ServiceScope,
	Service
} from './service.js';
export { type ServiceTag } from './token.js';
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
} from './wamp.js';
export { type WS, type WSError, Websocket } from './websocket.js';

/**
 * The type for the context of the application.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export interface AppHttpContext {
	decorator: Record<string, unknown>;
	store: Record<string, unknown>;
	derive: Record<string, unknown>;
}

export {
	type DomainErrorOptions,
	type ElysiumProblemCode,
	type DomainErrorDefinition,
	type ProblemCatalogue,
	type ProblemClass,
	type ProblemCode,
	type ProblemContext,
	type ProblemDetails,
	type ProblemOptions,
	type ProblemExtensions,
	type ProblemValidationError,
	BadRequestError,
	ConflictError,
	DomainError,
	ELYSIUM_PROBLEM_CODES,
	ForbiddenError,
	InternalError,
	isDomainError,
	isProblemDetails,
	NotFoundError,
	PROBLEM_CONTENT_TYPE,
	ProblemDetailsSchema,
	problemResponse,
	problemType,
	requestIdOf,
	statusTitle,
	toProblem,
	UnauthenticatedError,
	ValidationFailedError,
	validationErrors,
	validationExtensions
} from './problem.js';
export { type ExceptionFilter, type FilterClass, type FilterContext, Catch } from './filter.js';
export { type JsonForm, type ResponseSchemas, Resource } from './resource.js';
export {
	pageResponseSchema,
	PAGE_SCHEMA_KEYWORD,
	View,
	type ViewClass,
	type ViewInput,
	type ViewKind,
	ViewInputError,
	ViewNotRenderableError,
	type ViewOutput,
	type ViewPage,
	type ViewPagination,
	type ViewResponse,
	type ViewResponseOf,
	Views
} from './view.js';
export {
	type AppRateLimitOptions,
	type RateLimitHit,
	type RateLimitKeyContext,
	type RateLimitOptions,
	type RateLimitStore,
	MemoryRateLimitStore,
	RateLimit,
	TooManyRequestsError
} from './rate-limit.js';
export {
	type Interceptor,
	type InterceptorClass,
	type InterceptorContext,
	type ResponseSchemaHook,
	type TransformOptions,
	TimingInterceptor,
	TransformInterceptor
} from './interceptor.js';
export {
	type EnvironmentIssue,
	type SecretSchema,
	ConflictingEnvironmentSchemaError,
	InvalidEnvironmentError,
	mergeEnvironmentSchemas,
	Secret,
	validateEnvironment
} from './config.js';
export {
	type CorsOptions,
	type HttpOptions,
	type SecurityHeadersOptions,
	clientAddress,
	DEFAULT_BODY_LIMIT,
	InvalidCorsOptionsError,
	PayloadTooLargeError
} from './security.js';
export { LoggerModule } from './logging/logger.module.js';
export { RequestLogInterceptor } from './logging/interceptors/request-log.interceptor.js';
export { JsonConsoleLogger } from './logging/services/json-console.logger.js';
export { type HttpTransportOptions, HttpTransport } from './logging/transports/http.transport.js';
export { type LoggedOptions, Logged } from './logging/decorators/logged.js';
export { type LogFormat, type LoggerConfig, type TransportConfig } from './logging/types.js';
export { Json } from './json.js';
export {
	BigIntSerializer,
	DateSerializer,
	DuplicateSerializerError,
	MapSerializer,
	type RegisteredSerializer,
	Serializer,
	SetSerializer,
	type SerializerOptions,
	UnknownSerializerError
} from './serializer.js';
