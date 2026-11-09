---
'@elysiumjs/core': minor
'@elysiumjs/heracles': minor
'@elysiumjs/styx': patch
'@elysiumjs/hephaestus': patch
---

Services, factory definitions, HTTP controllers, commands and jobs take an `env` option, as modules do: the `NODE_ENV` values in which they are active. In any other environment they are left out when their module loads: an inactive service is not registered (nor returned by `injectAll`), an inactive controller mounts no routes, an inactive command is not listed and an inactive job is neither dispatched nor scheduled. `Environments` reads and records them, and `ModuleGraph.own()` lists the active controllers, commands or jobs of a module. Commands no longer have a static `dev` flag: `@Command.register({ env })` (or the module's `env`) says where a command is available.

Elysium knows three environments: `development`, `test` and `production`. `Environment` types every `env` option and `currentEnvironment()`, still accepting an app's own names such as `staging`. `Environments.isDevelopment()`, `isTest()` and `isProduction()` tell which one is current, and `Environments.local` (`['development', 'test']`) lists the environments that run on a developer's machine. The detail and stack of server errors are shown in `test` as well as in `development`.
