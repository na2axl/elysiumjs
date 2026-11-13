---
'@elysiumjs/bun': minor
'@elysiumjs/node': minor
'@elysiumjs/workers': minor
---

Runtime packages for `@elysiumjs/olympus`. `@elysiumjs/bun` provides the Bun runtime, Argon2id password hashing and the `local` disk over `Bun.file()`. `@elysiumjs/node` provides the Node.js runtime and HTTP server, and the `local` disk over `node:fs`. `@elysiumjs/workers` provides the Cloudflare Workers runtime and entry, bindings, queue and cron handlers, jobs on Cloudflare Queues, KV caches and sessions, rate limits, flows and locks in Durable Objects, and the `r2` disk with S3 presigned URLs. Import one runtime package per application.
