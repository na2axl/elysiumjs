---
'@elysiumjs/themis': minor
---

Secrets can be functions, and `Jwt` gains key rotation, a required expiry and a clock.

- The `ThemisModule` secret, JWT secrets and signed URL secrets accept a function (sync or async) called each time the secret is used, such as one reading a Workers secrets binding during the request.
- `Jwt.verify` takes `keys`, tried in order until one verifies the signature.
- Breaking: `Jwt.verify` refuses a token without `exp` by default. `requiredClaims` sets the claims a token must carry (`[]` accepts one without `exp`).
- `Jwt.verify` takes `currentDate`, and `Jwt.sign` takes `issuedAt`, which `expiresIn` counts from.
