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

import type {
	AuthenticationResponseJSON,
	AuthenticatorTransport,
	PublicKeyCredentialCreationOptionsJSON,
	PublicKeyCredentialRequestOptionsJSON,
	RegistrationResponseJSON
} from '@simplewebauthn/server';

import { DomainError } from '@elysiumjs/core';
import {
	generateAuthenticationOptions,
	generateRegistrationOptions,
	verifyAuthenticationResponse,
	verifyRegistrationResponse
} from '@simplewebauthn/server';

import { fromBase64Url, toBase64Url, utf8 } from './crypto';
import { Session } from './session';

/**
 * A passkey the app keeps for a user.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type PasskeyRecord = {
	/** The credential id, base64url. */
	id: string;
	userId: string;
	/** The COSE public key, base64url. */
	publicKey: string;
	/** The signature counter, which must grow (0 for authenticators that do not count). */
	counter: number;
	transports?: string[];
	/** Whether the passkey syncs between devices. */
	backedUp: boolean;
	deviceType: 'singleDevice' | 'multiDevice';
};

/**
 * Where the app keeps passkeys.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export interface PasskeyRepository {
	forUser(userId: string): Promise<PasskeyRecord[]>;
	find(id: string): Promise<PasskeyRecord | undefined>;
	save(record: PasskeyRecord): Promise<void>;
	updateCounter(id: string, counter: number): Promise<void>;
}

/**
 * Raised when a passkey registration or sign-in does not verify. Rendered as a 400 problem.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class PasskeyVerificationError extends DomainError {
	constructor(reason: string) {
		super({ status: 400, detail: `The passkey could not be verified: ${reason}.` });
	}
}

/**
 * The options of {@link Passkeys}.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type PasskeysOptions = {
	/** The name of the app, shown by the authenticator. */
	rpName: string;
	/** The relying party id: the domain, such as `example.com`. */
	rpID: string;
	/** The origins the browser may call from, such as `https://example.com`. */
	origin: string | string[];
	repository: PasskeyRepository;
	/** Defaults to `preferred`. */
	userVerification?: 'required' | 'preferred' | 'discouraged';
};

const REGISTRATION = '_passkey:registration';
const AUTHENTICATION = '_passkey:authentication';

/**
 * Registers passkeys and signs users in with them (WebAuthn), through @simplewebauthn/server. The
 * challenges live in the session; the passkeys in the app's {@link PasskeyRepository}.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class Passkeys {
	constructor(private readonly options: PasskeysOptions) {}

	/** The options of a new passkey of a user, for `navigator.credentials.create()`. */
	public async registrationOptions(user: {
		id: string;
		name: string;
		displayName?: string;
	}): Promise<PublicKeyCredentialCreationOptionsJSON> {
		const existing = await this.options.repository.forUser(user.id);
		const options = await generateRegistrationOptions({
			rpName: this.options.rpName,
			rpID: this.options.rpID,
			userName: user.name,
			userDisplayName: user.displayName ?? user.name,
			userID: utf8(user.id),
			attestationType: 'none',
			excludeCredentials: existing.map((passkey) => ({
				id: passkey.id,
				transports: passkey.transports as AuthenticatorTransport[] | undefined
			})),
			authenticatorSelection: {
				residentKey: 'preferred',
				userVerification: this.options.userVerification ?? 'preferred'
			}
		});
		Session.current().set(REGISTRATION, { challenge: options.challenge, userId: user.id });
		return options;
	}

	/**
	 * Verifies the answer of `navigator.credentials.create()` and saves the new passkey.
	 * @throws {PasskeyVerificationError} When it does not verify (400).
	 */
	public async verifyRegistration(response: RegistrationResponseJSON): Promise<PasskeyRecord> {
		const pending = Session.current().pull<{ challenge: string; userId: string }>(REGISTRATION);
		if (!pending) throw new PasskeyVerificationError('no registration is in progress');
		let result;
		try {
			result = await verifyRegistrationResponse({
				response,
				expectedChallenge: pending.challenge,
				expectedOrigin: this.options.origin,
				expectedRPID: this.options.rpID,
				requireUserVerification: this.options.userVerification === 'required'
			});
		} catch (error) {
			throw new PasskeyVerificationError((error as Error).message);
		}
		if (!result.verified) throw new PasskeyVerificationError('the response does not verify');
		const { credential, credentialBackedUp, credentialDeviceType } = result.registrationInfo;
		const record: PasskeyRecord = {
			id: credential.id,
			userId: pending.userId,
			publicKey: toBase64Url(credential.publicKey),
			counter: credential.counter,
			transports: credential.transports,
			backedUp: credentialBackedUp,
			deviceType: credentialDeviceType
		};
		await this.options.repository.save(record);
		return record;
	}

	/**
	 * The options of a sign-in, for `navigator.credentials.get()`. Without a user, any passkey of
	 * the site may answer (usernameless sign-in).
	 */
	public async authenticationOptions(user?: {
		id: string;
	}): Promise<PublicKeyCredentialRequestOptionsJSON> {
		const allowed = user ? await this.options.repository.forUser(user.id) : [];
		const options = await generateAuthenticationOptions({
			rpID: this.options.rpID,
			userVerification: this.options.userVerification ?? 'preferred',
			allowCredentials: allowed.map((passkey) => ({
				id: passkey.id,
				transports: passkey.transports as AuthenticatorTransport[] | undefined
			}))
		});
		Session.current().set(AUTHENTICATION, options.challenge);
		return options;
	}

	/**
	 * Verifies the answer of `navigator.credentials.get()`, updates the counter, and returns the
	 * passkey, whose `userId` is the user to sign in.
	 * @throws {PasskeyVerificationError} When it does not verify (400).
	 */
	public async verifyAuthentication(response: AuthenticationResponseJSON): Promise<PasskeyRecord> {
		const challenge = Session.current().pull<string>(AUTHENTICATION);
		if (!challenge) throw new PasskeyVerificationError('no sign-in is in progress');
		const passkey = await this.options.repository.find(response.id);
		if (!passkey) throw new PasskeyVerificationError('the passkey is unknown');
		let result;
		try {
			result = await verifyAuthenticationResponse({
				response,
				expectedChallenge: challenge,
				expectedOrigin: this.options.origin,
				expectedRPID: this.options.rpID,
				credential: {
					id: passkey.id,
					publicKey: fromBase64Url(passkey.publicKey),
					counter: passkey.counter,
					transports: passkey.transports as AuthenticatorTransport[] | undefined
				},
				requireUserVerification: this.options.userVerification === 'required'
			});
		} catch (error) {
			throw new PasskeyVerificationError((error as Error).message);
		}
		if (!result.verified) throw new PasskeyVerificationError('the response does not verify');
		await this.options.repository.updateCounter(passkey.id, result.authenticationInfo.newCounter);
		return { ...passkey, counter: result.authenticationInfo.newCounter };
	}
}
