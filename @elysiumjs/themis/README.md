# @elysiumjs/themis

Authentication for [Elysium.js](../core) apps: passwords, tokens, sessions, guards, CSRF, TOTP, OAuth/OpenID Connect and passkeys. It runs on Bun, Node.js and Cloudflare Workers.

## Installation

```bash
bun add @elysiumjs/themis
# Sessions in Redis or Workers KV
bun add @elysiumjs/themis-redis   # or @elysiumjs/themis-workers
```

## Setup

```ts
import { Application, Middleware } from '@elysiumjs/core';
import { Redis } from '@elysiumjs/redis';
import {
	apiKeyGuard,
	CsrfMiddleware,
	jwtGuard,
	sessionGuard,
	SessionMiddleware,
	ThemisModule
} from '@elysiumjs/themis';
import { RedisSessionStore } from '@elysiumjs/themis-redis';

@Application.register({
	modules: [
		ThemisModule.with({
			secret: env.APP_SECRET,
			session: {
				store: new RedisSessionStore({ connection: () => Redis.connection() }),
				ttl: 60 * 60 * 24 * 7
			},
			guards: {
				session: sessionGuard({ user: (id) => users.find(id) }),
				jwt: jwtGuard({ secret: env.JWT_SECRET, user: (claims) => users.find(claims.sub) }),
				apiKey: apiKeyGuard({ find: (hash) => keys.ownerOf(hash) })
			}
		}),
		AppModule
	]
})
@Middleware.register(SessionMiddleware, CsrfMiddleware)
class App extends Application {}
```

`secret` signs the session cookie, encrypts cookie sessions and binds CSRF tokens. Keep it in an environment secret. A secret under 32 bytes is refused at boot (`WeakSecretError`), and so are shorter JWT and signed URL secrets.

## Auth

```ts
import { Http } from '@elysiumjs/core';
import { Auth } from '@elysiumjs/themis';

@Http.controller('/me')
@Auth()
class MeController {
	@Http.get()
	public me() {
		return Auth.user();
	}

	@Http.get('/tokens')
	@Auth({ guards: ['jwt'] })
	public tokens() {
		/* ... */
	}
}
```

- `@Auth()` tries the configured guards in order, and `@Auth({ guards })` only the named ones. A guard is an object that implements `Guard`, or a guard class, which is built once through the service container so that its constructor gets services injected. It registers `AuthMiddleware`, so `@Middleware.register(AuthMiddleware.guards(['jwt']))` does the same as `@Auth({ guards: ['jwt'] })`.
- A request no guard accepts answers a 401 problem. `@Auth({ optional: true })` lets it through, and `Auth.check()` tells whether a user is signed in.
- The user is available through `Auth.user()` and `ctx.currentUser`, so cerberus can read it with `getSubject: (ctx) => ctx.currentUser`.
- `Auth.login(id)` signs a user in on the session (and regenerates it), and `Auth.logout()` signs them out.

## Sessions

```ts
import { Session } from '@elysiumjs/themis';

const session = Session.current();
session.set('cart', items);
session.flash('notice', 'Saved');
session.regenerate();
```

- The stores are `MemorySessionStore`, `RedisSessionStore` of [`@elysiumjs/themis-redis`](../themis-redis) and `KvSessionStore` of [`@elysiumjs/themis-workers`](../themis-workers) (a Workers KV binding). Without a store, sessions live in the memory of the process, and themis warns about it outside tests.
- `store: 'cookie'` keeps the whole session in an AES-GCM encrypted cookie. It must stay under 4000 characters (`SessionTooLargeError`), and a copied cookie stays valid until it expires, so keep revocable sessions in a store.
- The session cookie is signed, `HttpOnly`, `SameSite=Lax` and `Secure` by default.
- The session is saved after the handler runs, and also when the request ends with a client error (4xx), such as a sign-in followed by a thrown problem.

## CSRF

`CsrfMiddleware` protects cookie sessions with a synchronizer token kept in the session. Unsafe methods need the `x-csrf-token` header or the `_csrf` field to match `Csrf.token()`, or they answer a 403 problem.

## Passwords

```ts
import { Password } from '@elysiumjs/themis';

const hash = await Password.hash(input);
if ((await Password.verify(input, hash)) && Password.needsRehash(hash)) {
	await users.updateHash(id, await Password.hash(input));
}
```

The hasher is argon2id (`BunPasswordHasher`) on Bun and PBKDF2-SHA256 (`Pbkdf2PasswordHasher`) elsewhere, with 600,000 iterations (100,000 on Cloudflare Workers, which cap PBKDF2 there). `ScryptPasswordHasher`, from `@elysiumjs/themis/scrypt`, uses `node:crypto`. Pick one with `Password.use(hasher)`. Hashes describe their format, so `verify` reads all three.

## Tokens

```ts
import { ApiKeys, Jwt, SignedUrl } from '@elysiumjs/themis';

const token = await Jwt.sign({ role: 'admin' }, { secret, subject: user.id, expiresIn: 3600 });
const claims = await Jwt.verify(token, { secret });

const { key, hash } = await ApiKeys.generate({ prefix: 'sk' }); // store the hash, show the key once
await ApiKeys.verify(key, hash);

const link = await SignedUrl.sign('https://app.example.com/download/1', { secret, expiresIn: 600 });
await SignedUrl.verify(link, { secret });
```

`Jwt` signs with a secret (HS256) or with an asymmetric key and its algorithm. An invalid or expired token is a 401 problem, and an invalid or expired link a 403 problem.

`Jwt.verify` refuses a token without an expiry; pass `requiredClaims` to change the claims a token must carry (`[]` accepts one without `exp`). `currentDate` checks the expiry against another time, and `issuedAt` signs as of another time.

### Secrets read when they are used

Every secret (the `ThemisModule` secret, JWT secrets and signed URL secrets) can be a function, sync or async, called each time the secret is needed. Read it from a store bound to the request, such as a secrets binding on Cloudflare Workers, and a rotated secret is picked up without a restart. The 32-byte minimum is checked on each read.

```ts
ThemisModule.with({ secret: () => secrets.get('app-secret') });
```

During a rotation, verify with the current key and then the previous one:

```ts
const claims = await Jwt.verify(token, {
	keys: [
		{ secret: () => secrets.get('jwt-current') },
		{ secret: () => secrets.get('jwt-previous') }
	]
});
```

The keys are tried in order until one verifies the signature; an expired token or a wrong claim is refused at once.

## Two-factor codes

```ts
import { BackupCodes, Totp } from '@elysiumjs/themis';

const secret = Totp.generateSecret();
const qr = Totp.uri({ secret, issuer: 'Acme', account: user.email });
const counter = await Totp.verify(code, secret, { window: 1 }); // null when wrong

const { codes, hashes } = await BackupCodes.generate(10);
const { valid, remaining } = await BackupCodes.consume(typed, hashes);
```

Store the counter `Totp.verify` returns and refuse a code whose counter is not greater, so that a code works once.

Plain hashes let anyone with a copy of the table test guesses offline. Pass a key to hash the codes with HMAC instead, and the same key to use them:

```ts
const { codes, hashes } = await BackupCodes.generate(8, {
	secret: () => secrets.get('backup-codes')
});
const { valid, used } = await BackupCodes.consume(typed, hashes, {
	secret: () => secrets.get('backup-codes')
});
```

`used` is the hash the code matched, to mark that one used.

## OAuth and OpenID Connect

```ts
import { OAuthClient } from '@elysiumjs/themis';

const google = new OAuthClient({
	issuer: 'https://accounts.google.com',
	clientId: env.GOOGLE_CLIENT_ID,
	clientSecret: env.GOOGLE_CLIENT_SECRET,
	redirectUri: 'https://api.example.com/auth/google/callback'
});

// GET /auth/google
const url = await google.authorize();

// GET /auth/google/callback
const { tokens, claims, userInfo } = await google.callback(request.url);
```

The client uses the authorization code flow with PKCE. The state, the verifier and the OpenID Connect nonce are kept in the session. A provider without discovery takes `authorizationServer` with its endpoints. A callback with a wrong state or a failed exchange answers a 400 problem. Its detail names the OAuth error code the provider answered; any other failure is logged and answered with a fixed detail.

## Passkeys

```ts
import { Passkeys } from '@elysiumjs/themis';

const passkeys = new Passkeys({
	rpName: 'Acme',
	rpID: 'example.com',
	origin: 'https://example.com',
	repository: new PasskeyTable()
});

const options = await passkeys.registrationOptions({ id: user.id, name: user.email });
const record = await passkeys.verifyRegistration(response);

const challenge = await passkeys.authenticationOptions();
const used = await passkeys.verifyAuthentication(assertion); // used.userId signs the user in
```

The challenge is kept in the session. The app stores credentials by implementing `PasskeyRepository`. A response that does not verify answers a 400 problem. `updateCounter` gets the previous counter too: answer `false` when the stored one is no longer it, and the sign-in that lost the race is refused.

An app that keeps its own state between the two calls, such as a multi-step flow, or a client without a session cookie, sets `challenges: 'caller'` and passes the challenge back:

```ts
const passkeys = new Passkeys({ ...options, challenges: 'caller' });

const request = await passkeys.authenticationOptions({ id: user.id });
// keep request.challenge with the flow, then:
const used = await passkeys.verifyAuthentication(assertion, { challenge, userId: user.id });
```

With a `userId`, a passkey of another user is refused like an unknown one. A registration needs the `userId` it was for.
