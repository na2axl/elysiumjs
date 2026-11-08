---
'@elysiumjs/styx': minor
---

New projects declare their environment in `src/env.ts`: the schema the app passes as `env`, and the declaration that types `Env.get()` from it. It replaces `types.d.ts`, whose declaration did not compile and was skipped by `skipLibCheck`.
