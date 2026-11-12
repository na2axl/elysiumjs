// Copyright (c) 2026-present Axel Nana <ax.lnana@outlook.com>. All rights reserved.
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

// The port first: the driver files below register themselves on it.
export { Password, PasswordHasher, type PasswordHasherDriver } from './password';
export { Pbkdf2PasswordHasher } from './pbkdf2';
export { type ScryptOptions, ScryptPasswordHasher } from './scrypt';
export {
	AesGcmCipher,
	type AesGcmCipherOptions,
	Cipher,
	type CipherDriver,
	DecryptionFailedError
} from './cipher';
export {
	fromBase64Url,
	hmac,
	randomToken,
	safeEqual,
	sha256,
	toBase64Url,
	verifyHmac
} from './crypto';
export {
	InvalidTokenError,
	Jwt,
	type JwtKey,
	type JwtSignOptions,
	type JwtVerifyOptions
} from './jwt';
export {
	assertStrongSecret,
	MIN_SECRET_BYTES,
	resolveSecret,
	type Secret,
	WeakSecretError
} from './secret';
export { InvalidSignatureError, SignedUrl } from './signed-url';
