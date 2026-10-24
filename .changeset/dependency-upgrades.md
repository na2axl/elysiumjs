---
'@elysiumjs/core': minor
'@elysiumjs/argus': minor
'@elysiumjs/cerberus': minor
'@elysiumjs/hephaestus': minor
'@elysiumjs/heracles': minor
'@elysiumjs/plugin-sentry': minor
'@elysiumjs/styx': patch
'create-elysium': minor
---

Upgrade dependencies to their latest major versions: wampy 8, zod 4, commander 15, @casl/ability 7, OpenTelemetry SDK 2 (sdk-node 0.300, resources 3), @sentry/bun 11. Generated projects now use TypeScript 7.

Breaking in `@elysiumjs/core`: the WAMP `onChallenge` callback must return a string (or a promise of one); `null` is no longer accepted. `onError` now receives the error and `onReconnectSuccess` receives wampy's details object.
