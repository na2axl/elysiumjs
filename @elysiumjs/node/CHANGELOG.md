# @elysiumjs/node

## 0.1.5

### Patch Changes

- Updated dependencies [[`83468be`](https://github.com/na2axl/elysiumjs/commit/83468bebf825cad730a5e0b12f68d6226bafca30)]:
  - @elysiumjs/olympus@0.29.0

## 0.1.4

### Patch Changes

- Updated dependencies [[`7b3d398`](https://github.com/na2axl/elysiumjs/commit/7b3d398b9829b1f14e3ce73165caffa27c9007be), [`7b3d398`](https://github.com/na2axl/elysiumjs/commit/7b3d398b9829b1f14e3ce73165caffa27c9007be)]:
  - @elysiumjs/olympus@0.28.0

## 0.1.3

### Patch Changes

- Updated dependencies [[`d9c7abe`](https://github.com/na2axl/elysiumjs/commit/d9c7abe5ebd3bed2cad9536e1d57cf87ac906f20)]:
  - @elysiumjs/olympus@0.27.0

## 0.1.2

### Patch Changes

- [#127](https://github.com/na2axl/elysiumjs/pull/127) [`5d5a0bd`](https://github.com/na2axl/elysiumjs/commit/5d5a0bd13f4b4912aa857fc69c2fa03c36218026) Thanks [@na2axl](https://github.com/na2axl)! - The published declarations resolve under `moduleResolution: node16` and `nodenext`: their relative imports carry the `.js` extension, so the exported types no longer become `any` in those projects.
- Updated dependencies [[`5d5a0bd`](https://github.com/na2axl/elysiumjs/commit/5d5a0bd13f4b4912aa857fc69c2fa03c36218026)]:
  - @elysiumjs/olympus@0.26.2

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
