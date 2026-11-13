# @elysiumjs/node

## 0.1.0

### Minor Changes

- [#112](https://github.com/na2axl/elysiumjs/pull/112) [`72f76ff`](https://github.com/na2axl/elysiumjs/commit/72f76ff2f514aa15dce74d2bc29f0f8429cf5023) Thanks [@na2axl](https://github.com/na2axl)! - Runtime packages for `@elysiumjs/olympus`. `@elysiumjs/bun` provides the Bun runtime, Argon2id password hashing and the `local` disk over `Bun.file()`. `@elysiumjs/node` provides the Node.js runtime and HTTP server, and the `local` disk over `node:fs`. `@elysiumjs/workers` provides the Cloudflare Workers runtime and entry, bindings, queue and cron handlers, jobs on Cloudflare Queues, KV caches and sessions, rate limits, flows and locks in Durable Objects, and the `r2` disk with S3 presigned URLs. Import one runtime package per application.

### Patch Changes

- [#112](https://github.com/na2axl/elysiumjs/pull/112) [`72f76ff`](https://github.com/na2axl/elysiumjs/commit/72f76ff2f514aa15dce74d2bc29f0f8429cf5023) Thanks [@na2axl](https://github.com/na2axl)! - The package declares its `exports`, so Node.js resolves it without a bundler.
- Updated dependencies [[`72f76ff`](https://github.com/na2axl/elysiumjs/commit/72f76ff2f514aa15dce74d2bc29f0f8429cf5023), [`72f76ff`](https://github.com/na2axl/elysiumjs/commit/72f76ff2f514aa15dce74d2bc29f0f8429cf5023)]:
  - @elysiumjs/olympus@0.25.0
