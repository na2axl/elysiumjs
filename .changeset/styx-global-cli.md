---
'@elysiumjs/styx': minor
'@elysiumjs/hephaestus': patch
'create-elysium': minor
---

Styx is a global command: install it with `bun add -g @elysiumjs/styx`, then run `styx create my-app` to start a project (template, runtime, modules, plugins and features, from prompts or options). Inside a project, the global `styx` hands every command to the project's own Styx. The code generators (`make:*`, `module:*`) run without starting the app, and new projects install Styx as a dev dependency.

When a project installs `@elysiumjs/hephaestus` as a dev dependency, Styx provides its commands. Standalone `styx` executables are built with Hephaestus (`bun run build:bin`), with the stubs and templates embedded. The Hephaestus asset embedder includes dotfiles.

`create-elysium` runs `styx create`; the project templates live in `@elysiumjs/styx`.
