# @elysiumjs/node

## 0.1.1

### Patch Changes

- [#120](https://github.com/na2axl/elysiumjs/pull/120) [`2a23e4a`](https://github.com/na2axl/elysiumjs/commit/2a23e4aad9bcb3bddc8279f9ef358f70fa2ff149) Thanks [@na2axl](https://github.com/na2axl)! - Disks keep a `Cache-Control` header: `put()` takes `cacheControl`, `head()` and `get()` answer it, and the signed download route sends it. An upload purpose sets it on its ready files with a `cacheControl` getter. `uploadTtl`, `unclaimedTtl` and `maxPending` of `PithosModule.with({ files })` also take a function, read each time the value is used.

  Files carry `metadata`, a JSON object of what their purpose tells about them, such as the length of a video. An upload purpose fills it with `metadata(file, bytes)` when the file is finished (typed by `Upload<TMetadata>`; throwing refuses the file), and `Files.describe(id, metadata)` adds to it later. `filesTable()` adds a `metadata jsonb not null default '{}'` column: generate a migration.

- Updated dependencies [[`01b9aee`](https://github.com/na2axl/elysiumjs/commit/01b9aee40eb1c432e253fdc47cb89d848e102228), [`2a23e4a`](https://github.com/na2axl/elysiumjs/commit/2a23e4aad9bcb3bddc8279f9ef358f70fa2ff149), [`01b9aee`](https://github.com/na2axl/elysiumjs/commit/01b9aee40eb1c432e253fdc47cb89d848e102228), [`b4f6567`](https://github.com/na2axl/elysiumjs/commit/b4f65674e19dc1a8c8b16a2160911c82044015ec), [`01b9aee`](https://github.com/na2axl/elysiumjs/commit/01b9aee40eb1c432e253fdc47cb89d848e102228)]:
  - @elysiumjs/olympus@0.26.0

## 0.1.0

### Minor Changes

- [#112](https://github.com/na2axl/elysiumjs/pull/112) [`72f76ff`](https://github.com/na2axl/elysiumjs/commit/72f76ff2f514aa15dce74d2bc29f0f8429cf5023) Thanks [@na2axl](https://github.com/na2axl)! - Runtime packages for `@elysiumjs/olympus`. `@elysiumjs/bun` provides the Bun runtime, Argon2id password hashing and the `local` disk over `Bun.file()`. `@elysiumjs/node` provides the Node.js runtime and HTTP server, and the `local` disk over `node:fs`. `@elysiumjs/workers` provides the Cloudflare Workers runtime and entry, bindings, queue and cron handlers, jobs on Cloudflare Queues, KV caches and sessions, rate limits, flows and locks in Durable Objects, and the `r2` disk with S3 presigned URLs. Import one runtime package per application.

### Patch Changes

- [#112](https://github.com/na2axl/elysiumjs/pull/112) [`72f76ff`](https://github.com/na2axl/elysiumjs/commit/72f76ff2f514aa15dce74d2bc29f0f8429cf5023) Thanks [@na2axl](https://github.com/na2axl)! - The package declares its `exports`, so Node.js resolves it without a bundler.
- Updated dependencies [[`72f76ff`](https://github.com/na2axl/elysiumjs/commit/72f76ff2f514aa15dce74d2bc29f0f8429cf5023), [`72f76ff`](https://github.com/na2axl/elysiumjs/commit/72f76ff2f514aa15dce74d2bc29f0f8429cf5023)]:
  - @elysiumjs/olympus@0.25.0
