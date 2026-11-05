---
'@elysiumjs/core': minor
'@elysiumjs/styx': minor
---

`styx routes:generate` writes the route types of an app to `src/routes.gen.ts`: an `AppRoutes` type for Eden (`treaty<AppRoutes>(url)`), built from the controllers of every module. Request types come from the method parameters decorated with `@Http.param`, `@Http.query` and `@Http.body`, and response types from the method return types. The file holds types only; requests are served by the decorated controllers. New projects run the command in their `typecheck` script and keep the file out of git.

`Http.describe(controller)` reports the routes of an HTTP controller, and `Application.moduleGraph()` builds the module graph of an app class without booting it.
