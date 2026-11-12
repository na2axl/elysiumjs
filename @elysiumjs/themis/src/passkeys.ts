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
 * @author Axel Nana <ax.lnana@outlook.com>
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
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export interface PasskeyRepository {
	forUser(userId: string): Promise<PasskeyRecord[]>;
	find(id: string): Promise<PasskeyRecord | undefined>;
	save(record: PasskeyRecord): Promise<void>;
	/**
	 * Moves the counter of a passkey from `previous` to `counter`. Answer `false` when it no longer
	 * is `previous`, such as when another sign-in used the passkey first, to refuse this one.
	 */
	updateCounter(id: string, counter: number, previous: number): Promise<void | boolean>;
}

/**
 * Raised when a passkey registration or sign-in does not verify. Rendered as a 400 problem.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class PasskeyVerificationError extends DomainError.for('PASSKEY_VERIFICATION_FAILED', 400) {
	constructor(reason: string) {
		super(`The passkey could not be verified: ${reason}.`);
	}
}

/**
 * The options of {@link Passkeys}.
 * @author Axel Nana <ax.lnana@outlook.com>
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
	/**
	 * Whether a new passkey must be discoverable, so that it can sign in without a username.
	 * Defaults to `preferred`.
	 */
	residentKey?: 'required' | 'preferred' | 'discouraged';
	/** How long the client has to answer, in milliseconds. */
	timeout?: number;
	/**
	 * Where the challenges live between the options and the answer. `session` (the default) keeps
	 * them in the session. `caller` leaves them to the app, such as in the state of a multi-step
	 * flow: it reads `challenge` from the options and passes it back to the verify method.
	 */
	challenges?: 'session' | 'caller';
};

/**
 * A challenge the app kept itself (`challenges: 'caller'`), passed back to a verify method.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export type PasskeyChallenge = {
	/** The `challenge` of the options the client answered. */
	challenge: string;
	/**
	 * The user the options were for. Required to register; to sign in, a passkey of another user
	 * is refused.
	 */
	userId?: string;
};

/** The user id behind a user handle, or `undefined` when it is not UTF-8 text in base64url. */
const userOfHandle = (handle: string): string | undefined => {
	try {
		return new TextDecoder('utf-8', { fatal: true }).decode(fromBase64Url(handle));
	} catch {
		return undefined;
	}
};

const REGISTRATION = '_passkey:registration';
const AUTHENTICATION = '_passkey:authentication';

/**
 * Registers passkeys and signs users in with them (WebAuthn), through @simplewebauthn/server. The
 * challenges live in the session, or with the app (`challenges: 'caller'`); the passkeys in the
 * app's {@link PasskeyRepository}.
 * @author Axel Nana <ax.lnana@outlook.com>
 */
export class Passkeys {
	constructor(private readonly options: PasskeysOptions) {}

	private get callerKeeps(): boolean {
		return this.options.challenges === 'caller';
	}

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
			...(this.options.timeout !== undefined && { timeout: this.options.timeout }),
			excludeCredentials: existing.map((passkey) => ({
				id: passkey.id,
				transports: passkey.transports as AuthenticatorTransport[] | undefined
			})),
			authenticatorSelection: {
				residentKey: this.options.residentKey ?? 'preferred',
				userVerification: this.options.userVerification ?? 'preferred'
			}
		});
		if (!this.callerKeeps)
			Session.current().set(REGISTRATION, { challenge: options.challenge, userId: user.id });
		return options;
	}

	/**
	 * Verifies the answer of `navigator.credentials.create()` and saves the new passkey.
	 * @param response The answer of the client.
	 * @param kept The challenge and the user, when the app keeps the challenges.
	 * @throws {PasskeyVerificationError} When it does not verify (400).
	 */
	public async verifyRegistration(
		response: RegistrationResponseJSON,
		kept?: PasskeyChallenge
	): Promise<PasskeyRecord> {
		const pending = this.callerKeeps
			? kept
			: Session.current().pull<{ challenge: string; userId: string }>(REGISTRATION);
		if (!pending?.userId) throw new PasskeyVerificationError('no registration is in progress');
		const userId = pending.userId;
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
			userId,
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
			...(this.options.timeout !== undefined && { timeout: this.options.timeout }),
			allowCredentials: allowed.map((passkey) => ({
				id: passkey.id,
				transports: passkey.transports as AuthenticatorTransport[] | undefined
			}))
		});
		if (!this.callerKeeps) Session.current().set(AUTHENTICATION, options.challenge);
		return options;
	}

	/**
	 * Verifies the answer of `navigator.credentials.get()`, updates the counter, and returns the
	 * passkey, whose `userId` is the user to sign in.
	 * @param response The answer of the client.
	 * @param kept The challenge, when the app keeps the challenges, and the user it was for, if any.
	 * @throws {PasskeyVerificationError} When it does not verify (400).
	 */
	public async verifyAuthentication(
		response: AuthenticationResponseJSON,
		kept?: PasskeyChallenge
	): Promise<PasskeyRecord> {
		const challenge = this.callerKeeps
			? kept?.challenge
			: Session.current().pull<string>(AUTHENTICATION);
		if (!challenge) throw new PasskeyVerificationError('no sign-in is in progress');
		const passkey = await this.options.repository.find(response.id);
		// Another user's passkey reads like an unknown one, so the answer tells nothing about it.
		if (!passkey || (kept?.userId !== undefined && passkey.userId !== kept.userId))
			throw new PasskeyVerificationError('the passkey is unknown');
		// The user handle the authenticator kept must be the passkey's user.
		const handle = response.response.userHandle;
		if (handle !== undefined && userOfHandle(handle) !== passkey.userId)
			throw new PasskeyVerificationError('the passkey belongs to another user');
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
		const moved = await this.options.repository.updateCounter(
			passkey.id,
			result.authenticationInfo.newCounter,
			passkey.counter
		);
		if (moved === false) throw new PasskeyVerificationError('the passkey was used meanwhile');
		return { ...passkey, counter: result.authenticationInfo.newCounter };
	}
}
