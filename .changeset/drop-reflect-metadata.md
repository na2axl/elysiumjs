---
'@elysiumjs/core': minor
'@elysiumjs/heracles': minor
'@elysiumjs/mnemosyne': minor
'@elysiumjs/styx': minor
'create-elysium': minor
---

Drop the `reflect-metadata` dependency. Decorator metadata now lives in a small store in `@elysiumjs/core`, exported as `Metadata` (`define`, `get`, `getOwn`, `has`). Use it instead of `Reflect.defineMetadata` and `Reflect.getMetadata` to read or write Elysium metadata.

Apps no longer need `import 'reflect-metadata'` in their entrypoint, and generated projects leave it out. Keep `emitDecoratorMetadata` enabled: `@Service.inject()` and `@Command.arg()` still infer types from it. An app that loads `reflect-metadata` for another library keeps working; Elysium also reads the types stored there.
