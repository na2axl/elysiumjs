---
'@elysiumjs/plugin-sentry': minor
---

`SentryModule` declares `SENTRY_DSN` and `SENTRY_ENVIRONMENT` in its environment schema (`SentryEnv`), so they are validated at boot and typed in `Env.get()`.
