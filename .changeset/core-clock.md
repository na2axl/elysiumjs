---
'@elysiumjs/core': minor
'@elysiumjs/moirai': minor
'@elysiumjs/moirai-drizzle': minor
'@elysiumjs/heracles': minor
'@elysiumjs/themis': minor
---

`Clock` in core: `Clock.now()` and `Clock.epochMs()` give the application time, which `Clock.freeze()` and `Clock.travel()` stop or move in development and test, and `Clock.use()` takes from another source. Moirai (event, stream, projection and outbox instants, idempotency records), the projection store of moirai-drizzle, Heracles scheduler ticks and Themis (JWT issue and expiry checks, sessions, signed URLs, TOTP) read the time from it.
