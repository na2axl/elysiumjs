---
'@elysiumjs/styx': minor
'@elysiumjs/hephaestus': patch
'create-elysium': minor
---

Styx is now a global command, like `nest`: install it with `bun add -g @elysiumjs/styx`, then run `styx create my-app` to start a project (template, runtime, modules, plugins and features, from prompts or options). Inside a project, the global `styx` hands every command to the project's own Styx. The code generators (`make:*`, `module:*`) run without starting the app, so `StyxModule` is no longer needed in the app's modules, and new projects install Styx as a dev dependency.

When a project installs `@elysiumjs/hephaestus`, Styx provides its commands, so Hephaestus becomes a dev dependency and apps no longer import `HephaestusModule`. Standalone `styx` executables are built with Hephaestus (`bun run build:bin`), with the stubs and templates embedded. The Hephaestus asset embedder now includes dotfiles.

`create-elysium` now runs `styx create`, and the project templates moved into `@elysiumjs/styx`.
