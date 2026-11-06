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
	AuthorizationServer,
	Client,
	IDToken,
	TokenEndpointResponse,
	UserInfoResponse
} from 'oauth4webapi';

import { DomainError } from '@elysiumjs/core';
import * as oauth from 'oauth4webapi';

import { Session } from './session';

/**
 * Raised when an OAuth callback does not check out: a wrong state, an error from the provider, or
 * a failed code exchange. Rendered as a 400 problem.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class OAuthCallbackError extends DomainError {
	constructor(reason: string) {
		super({ status: 400, detail: `The sign-in could not be completed: ${reason}.` });
	}
}

/**
 * The options of an OAuth 2.0 / OpenID Connect client.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type OAuthClientOptions = {
	/** The name of the client, when the app has several providers. Defaults to `default`. */
	name?: string;
	/** The issuer, whose metadata is discovered (`/.well-known/openid-configuration`). */
	issuer?: string;
	/** The endpoints of a provider without discovery, such as GitHub. */
	authorizationServer?: AuthorizationServer;
	clientId: string;
	/** The client secret, sent in the token request. Omit it for a public client. */
	clientSecret?: string;
	/** The callback URL registered with the provider. */
	redirectUri: string;
	/** The scopes. Defaults to `openid email profile`. */
	scopes?: string[];
	/** A fetch for the provider's endpoints, such as a test double. */
	fetch?: typeof fetch;
};

/**
 * What a successful callback gives: the tokens, and for OpenID Connect the claims of the ID token
 * and the user info.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type OAuthResult = {
	tokens: TokenEndpointResponse;
	claims?: IDToken;
	userInfo?: UserInfoResponse;
};

type Pending = { state: string; verifier: string; nonce?: string };

/**
 * Signs users in with an OAuth 2.0 or OpenID Connect provider, with the authorization code flow
 * and PKCE, through oauth4webapi. The state, the PKCE verifier and the nonce live in the session.
 * @author Axel Nana <axel.nana@workbud.com>
 * @example
 * ```ts
 * const google = new OAuthClient({
 * 	issuer: 'https://accounts.google.com',
 * 	clientId: env.GOOGLE_CLIENT_ID,
 * 	clientSecret: env.GOOGLE_CLIENT_SECRET,
 * 	redirectUri: 'https://api.example.com/auth/google/callback'
 * });
 *
 * // GET /auth/google: redirect to (await google.authorize()).
 * // GET /auth/google/callback: const { claims } = await google.callback(request.url);
 * ```
 */
export class OAuthClient {
	#server?: Promise<AuthorizationServer>;

	constructor(private readonly options: OAuthClientOptions) {
		if (!options.issuer && !options.authorizationServer) {
			throw new TypeError('An OAuthClient needs an issuer or an authorizationServer.');
		}
	}

	private get oidc(): boolean {
		return this.scopes.includes('openid');
	}

	private get scopes(): string[] {
		return this.options.scopes ?? ['openid', 'email', 'profile'];
	}

	private get sessionKey(): string {
		return `_oauth:${this.options.name ?? 'default'}`;
	}

	private get client(): Client {
		return { client_id: this.options.clientId };
	}

	private get auth(): oauth.ClientAuth {
		return this.options.clientSecret
			? oauth.ClientSecretPost(this.options.clientSecret)
			: oauth.None();
	}

	private get requestOptions() {
		return this.options.fetch ? { [oauth.customFetch]: this.options.fetch } : {};
	}

	/** The provider's metadata: given, or discovered once. */
	public server(): Promise<AuthorizationServer> {
		if (this.options.authorizationServer) return Promise.resolve(this.options.authorizationServer);
		this.#server ??= (async () => {
			const issuer = new URL(this.options.issuer!);
			const response = await oauth.discoveryRequest(issuer, {
				algorithm: this.oidc ? 'oidc' : 'oauth2',
				...this.requestOptions
			});
			return oauth.processDiscoveryResponse(issuer, response);
		})();
		this.#server.catch(() => (this.#server = undefined));
		return this.#server;
	}

	/**
	 * The URL to send the user to, with a new state, PKCE challenge and nonce kept in the session.
	 * @param params Extra parameters, such as `prompt` or `login_hint`.
	 */
	public async authorize(params: Record<string, string> = {}): Promise<URL> {
		const server = await this.server();
		if (!server.authorization_endpoint)
			throw new TypeError('The provider has no authorization endpoint.');
		const pending: Pending = {
			state: oauth.generateRandomState(),
			verifier: oauth.generateRandomCodeVerifier(),
			nonce: this.oidc ? oauth.generateRandomNonce() : undefined
		};
		Session.current().set(this.sessionKey, pending);

		const url = new URL(server.authorization_endpoint);
		url.searchParams.set('response_type', 'code');
		url.searchParams.set('client_id', this.options.clientId);
		url.searchParams.set('redirect_uri', this.options.redirectUri);
		url.searchParams.set('scope', this.scopes.join(' '));
		url.searchParams.set('state', pending.state);
		url.searchParams.set(
			'code_challenge',
			await oauth.calculatePKCECodeChallenge(pending.verifier)
		);
		url.searchParams.set('code_challenge_method', 'S256');
		if (pending.nonce) url.searchParams.set('nonce', pending.nonce);
		for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
		return url;
	}

	/**
	 * Completes the sign-in on the callback: checks the state, exchanges the code, and validates
	 * the ID token. The pending state is used up, whatever the outcome.
	 * @param currentUrl The URL of the callback request, with its query.
	 * @throws {OAuthCallbackError} When the callback does not check out (400).
	 */
	public async callback(currentUrl: string | URL): Promise<OAuthResult> {
		const session = Session.current();
		const pending = session.pull<Pending>(this.sessionKey);
		if (!pending) throw new OAuthCallbackError('no sign-in is in progress');
		const server = await this.server();
		try {
			const params = oauth.validateAuthResponse(
				server,
				this.client,
				new URL(currentUrl),
				pending.state
			);
			const response = await oauth.authorizationCodeGrantRequest(
				server,
				this.client,
				this.auth,
				params,
				this.options.redirectUri,
				pending.verifier,
				this.requestOptions
			);
			const tokens = await oauth.processAuthorizationCodeResponse(server, this.client, response, {
				expectedNonce: pending.nonce,
				requireIdToken: this.oidc
			});
			if (!this.oidc) return { tokens };

			const claims = oauth.getValidatedIdTokenClaims(tokens);
			let userInfo: UserInfoResponse | undefined;
			if (server.userinfo_endpoint && claims) {
				const info = await oauth.userInfoRequest(
					server,
					this.client,
					tokens.access_token,
					this.requestOptions
				);
				userInfo = await oauth.processUserInfoResponse(server, this.client, claims.sub, info);
			}
			return { tokens, claims, userInfo };
		} catch (error) {
			if (error instanceof DomainError) throw error;
			const cause = error as { error?: string; error_description?: string; message?: string };
			throw new OAuthCallbackError(
				cause.error_description ?? cause.error ?? cause.message ?? 'unknown error'
			);
		}
	}
}
