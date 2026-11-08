---
'@elysiumjs/core': minor
---

`Env.get()` is typed from the environment schemas:

- `AppEnv` is empty in core. The app and its modules augment it next to their schemas with `interface AppEnv extends Env.Infer<typeof schema> {}`. Once any variable is declared, `Env.get()` only accepts declared names and returns their validated types, with a `Secret` for each `Secret.schema()` variable. Without any, it takes any name and returns the raw string.
- `Env.Infer<typeof schema>` gives the validated type of an environment schema, and `Secret.schema()` keeps the type of its schema.
- In an app with an `env` schema, reading `Env` before the environment is validated throws `EnvironmentNotReadyError`, instead of returning raw values.
