// Copyright (c) 2026-present Workbud Technologies Inc. All rights reserved.
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

export { ApiKeys } from './api-keys';
export {
	apiKeyGuard,
	Auth,
	AuthMiddleware,
	type AuthOptions,
	type AuthUser,
	type Guard,
	type GuardClass,
	jwtGuard,
	sessionGuard
} from './auth';
export { THEMIS_CONFIG, type ThemisConfig } from './config';
export { type CookieOptions, type HttpContext } from './context';
export { Csrf, CsrfMiddleware } from './csrf';
export {
	CsrfTokenMismatchError,
	MIN_SECRET_BYTES,
	MissingThemisConfigError,
	NoSessionError,
	SessionTooLargeError,
	UnauthenticatedError,
	UnknownGuardError,
	WeakSecretError
} from './errors';
export {
	InvalidTokenError,
	Jwt,
	type JwtKey,
	type JwtSignOptions,
	type JwtVerifyOptions
} from './jwt';
export { BunPasswordHasher, Password, type PasswordHasher, Pbkdf2PasswordHasher } from './password';
export {
	commitSession,
	loadSession,
	MemorySessionStore,
	Session,
	type SessionData,
	SessionMiddleware,
	type SessionStore
} from './session';
export {
	OAuthCallbackError,
	OAuthClient,
	type OAuthClientOptions,
	type OAuthResult
} from './oauth';
export {
	type PasskeyChallenge,
	type PasskeyRecord,
	type PasskeyRepository,
	Passkeys,
	type PasskeysOptions,
	PasskeyVerificationError
} from './passkeys';
export { type Secret } from './secret';
export { InvalidSignatureError, SignedUrl } from './signed-url';
export { ThemisModule } from './themis.module';
export { type BackupCodeOptions, BackupCodes, Totp, type TotpOptions } from './totp';
