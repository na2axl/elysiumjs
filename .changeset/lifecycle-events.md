---
'@elysiumjs/core': minor
'@elysiumjs/heracles': patch
'@elysiumjs/mnemosyne': patch
'@elysiumjs/styx': patch
---

The framework event bus is `Lifecycle`: `Lifecycle.on`, `Lifecycle.once`, `Lifecycle.emit`, `Lifecycle.off`, `@Lifecycle.on()` and `@Lifecycle.once()`, with the `LifecycleEvent` and `LifecycleHandler` types. It carries the framework's own signals (`elysium:error`, app and server lifecycle, heracles queue events) and in-process listeners.
